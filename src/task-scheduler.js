/**
 * 后台任务调度器 (V1.5+) - 防爆增强版
 * 管理 AI 特征提取等耗时任务，支持优先级队列和资源节流
 * 新增：模型懒加载、IPC节流、紧急内存清理
 *
 * 设计原则：
 * - 解耦：扫描线程只提交任务，不直接执行 AI 推理
 * - 节流：监控系统负载，自动调整并发度
 * - 可恢复：支持暂停/恢复，应用重启后可继续
 * - 防爆：动态降级、模型自动卸载、IPC分片
 */

const { EventEmitter } = require('events');
const os = require('os');
const v8 = require('v8');

class TaskScheduler extends EventEmitter {
  constructor(options = {}) {
    super();

    // 配置选项 - 新增防爆参数
    this.options = {
      maxConcurrency: options.maxConcurrency || 2,      // 最大并发任务数
      cpuThreshold: options.cpuThreshold || 80,         // CPU 使用率阈值 (%)
      memoryThreshold: options.memoryThreshold || 85,   // 内存使用率阈值 (%)
      memoryCritical: options.memoryCritical || 95,     // 内存紧急阈值 (%)
      idleDelay: options.idleDelay || 5000,             // 系统空闲检测间隔 (ms)
      enableThrottling: options.enableThrottling !== false, // 是否启用节流
      modelIdleTimeout: options.modelIdleTimeout || 60 * 60 * 1000, // 模型空闲卸载时间 (60分钟)
      ipcChunkSize: options.ipcChunkSize || 1000,       // IPC分片大小
      enableModelLazyLoad: options.enableModelLazyLoad !== false, // 模型懒加载
      ...options
    };

    // 任务队列 (按优先级)
    this.queues = {
      P0: [],  // 最高优先级 - UI 响应
      P1: [],  // 高优先级 - 传统哈希计算
      P2: [],  // 中优先级 - AI 特征提取
      P3: []   // 低优先级 - 模型加载/卸载
    };

    // 运行状态
    this.runningTasks = new Map();  // taskId -> task
    this.isRunning = false;
    this.isPaused = false;
    this.stats = {
      totalSubmitted: 0,
      totalCompleted: 0,
      totalFailed: 0,
      totalCancelled: 0,
      throttledCount: 0,
      emergencyCleanups: 0
    };

    // 系统监控
    this.lastCpuUsage = os.cpus().map(cpu => cpu.times);
    this.systemLoad = {
      cpu: 0,
      memory: 0,
      heapUsed: 0,
      heapTotal: 0,
      isIdle: true,
      isCritical: false
    };

    // 模型管理
    this.loadedModels = new Map();  // modelName -> {instance, lastUsed, refCount}
    this.modelLoadTasks = new Map(); // modelName -> Promise

    // 启动系统监控
    this._startSystemMonitor();

    // 启动模型空闲检查
    this._startModelIdleMonitor();
  }

  /**
   * 提交任务
   * @param {string} type - 任务类型 ('hash' | 'embedding' | 'clip' | 'llm' | 'model-load')
   * @param {Function} executor - 任务执行函数
   * @param {Object} context - 任务上下文（文件路径等）
   * @returns {Promise} - 任务完成的 Promise
   */
  submit(type, executor, context = {}) {
    const priority = this._getPriority(type);
    const task = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      priority,
      executor,
      context,
      status: 'pending',  // pending | running | completed | failed | cancelled
      submittedAt: Date.now(),
      startedAt: null,
      completedAt: null,
      error: null,
      result: null,
      retryCount: 0,
      maxRetries: type === 'llm' ? 2 : 1  // LLM任务重试次数更多
    };

    // 创建 Promise
    const promise = new Promise((resolve, reject) => {
      task.resolve = resolve;
      task.reject = reject;
    });

    // 加入队列
    this.queues[priority].push(task);
    this.stats.totalSubmitted++;

    this.emit('task:submitted', task);

    // 尝试启动处理
    this._processQueues();

    return promise;
  }

  /**
   * 批量提交任务 - 带IPC节流
   */
  submitBatch(tasks, onProgress) {
    const results = [];
    const chunkSize = this.options.ipcChunkSize;

    return new Promise(async (resolve, reject) => {
      try {
        for (let i = 0; i < tasks.length; i += chunkSize) {
          const chunk = tasks.slice(i, i + chunkSize);

          // 检查系统负载，如果过高则等待
          while (this._shouldThrottle()) {
            this.emit('scheduler:throttled', this.systemLoad);
            await new Promise(r => setTimeout(r, 1000));
          }

          // 提交这一批
          const chunkPromises = chunk.map(t =>
            this.submit(t.type, t.executor, t.context)
          );

          const chunkResults = await Promise.allSettled(chunkPromises);
          results.push(...chunkResults);

          if (onProgress) {
            onProgress(Math.min(i + chunkSize, tasks.length), tasks.length);
          }

          // 让出事件循环，避免阻塞
          await new Promise(r => setImmediate(r));
        }

        resolve(results);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * 获取或加载模型（懒加载）
   */
  async getModel(modelName, loadFn) {
    // 检查是否已加载
    if (this.loadedModels.has(modelName)) {
      const model = this.loadedModels.get(modelName);
      model.lastUsed = Date.now();
      model.refCount++;
      return model.instance;
    }

    // 检查是否正在加载中
    if (this.modelLoadTasks.has(modelName)) {
      return this.modelLoadTasks.get(modelName);
    }

    // 检查内存是否充足
    if (this.systemLoad.memory > this.options.memoryThreshold) {
      // 尝试卸载不常用的模型
      await this._unloadLeastUsedModels();
    }

    // 如果内存仍然紧张，拒绝加载
    if (this.systemLoad.memory > this.options.memoryCritical) {
      throw new Error(`内存不足 (${this.systemLoad.memory}%)，无法加载模型 ${modelName}`);
    }

    // 加载模型
    const loadPromise = this._loadModelInternal(modelName, loadFn);
    this.modelLoadTasks.set(modelName, loadPromise);

    try {
      const instance = await loadPromise;
      this.loadedModels.set(modelName, {
        instance,
        lastUsed: Date.now(),
        refCount: 1,
        loadedAt: Date.now()
      });
      this.emit('model:loaded', modelName);
      return instance;
    } finally {
      this.modelLoadTasks.delete(modelName);
    }
  }

  /**
   * 内部加载模型
   */
  async _loadModelInternal(modelName, loadFn) {
    // 作为P3任务提交，低优先级
    return this.submit('model-load', async () => {
      console.log(`[TaskScheduler] 加载模型: ${modelName}`);
      const startTime = Date.now();
      const instance = await loadFn();
      console.log(`[TaskScheduler] 模型 ${modelName} 加载完成，耗时 ${Date.now() - startTime}ms`);
      return instance;
    }, { modelName });
  }

  /**
   * 释放模型引用
   */
  releaseModel(modelName) {
    const model = this.loadedModels.get(modelName);
    if (model) {
      model.refCount = Math.max(0, model.refCount - 1);
    }
  }

  /**
   * 卸载模型
   */
  async unloadModel(modelName) {
    const model = this.loadedModels.get(modelName);
    if (!model) return;

    console.log(`[TaskScheduler] 卸载模型: ${modelName}`);

    // 如果模型有unload方法，调用它
    if (model.instance && typeof model.instance.unload === 'function') {
      await model.instance.unload();
    }

    // 强制垃圾回收建议
    if (global.gc) {
      global.gc();
    }

    this.loadedModels.delete(modelName);
    this.emit('model:unloaded', modelName);
  }

  /**
   * 卸载最少使用的模型
   */
  async _unloadLeastUsedModels() {
    const models = Array.from(this.loadedModels.entries())
      .filter(([_, m]) => m.refCount === 0)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    if (models.length > 0) {
      // 卸载最久未使用的
      await this.unloadModel(models[0][0]);
    }
  }

  /**
   * 紧急内存清理
   */
  async _emergencyCleanup() {
    console.warn('[TaskScheduler] 触发紧急内存清理!');
    this.stats.emergencyCleanups++;

    // 暂停所有P2/P3任务
    this.pause();

    // 等待当前任务完成
    await this._waitForRunningTasks();

    // 卸载所有模型
    for (const [modelName] of this.loadedModels) {
      await this.unloadModel(modelName);
    }

    // 强制垃圾回收
    if (global.gc) {
      global.gc();
    }

    // 释放V8内存
    v8.writeHeapSnapshot && v8.writeHeapSnapshot();

    this.emit('scheduler:emergency-cleanup');

    // 恢复运行
    setTimeout(() => this.resume(), 2000);
  }

  /**
   * 等待当前运行的任务完成
   */
  async _waitForRunningTasks() {
    while (this.runningTasks.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * 启动调度器
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isPaused = false;
    this.emit('scheduler:started');
    this._processQueues();
  }

  /**
   * 暂停调度器（优雅暂停，等待当前任务完成）
   */
  pause() {
    this.isPaused = true;
    this.emit('scheduler:paused');
  }

  /**
   * 恢复调度器
   */
  resume() {
    this.isPaused = false;
    this.emit('scheduler:resumed');
    this._processQueues();
  }

  /**
   * 停止调度器（取消所有待处理任务）
   */
  stop() {
    this.isRunning = false;

    // 取消所有待处理任务
    for (const priority of ['P0', 'P1', 'P2', 'P3']) {
      const queue = this.queues[priority];
      while (queue.length > 0) {
        const task = queue.shift();
        task.status = 'cancelled';
        task.reject(new Error('调度器已停止'));
        this.stats.totalCancelled++;
        this.emit('task:cancelled', task);
      }
    }

    this.emit('scheduler:stopped');
  }

  /**
   * 获取队列状态
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      queues: {
        P0: this.queues.P0.length,
        P1: this.queues.P1.length,
        P2: this.queues.P2.length,
        P3: this.queues.P3.length
      },
      running: this.runningTasks.size,
      models: {
        loaded: this.loadedModels.size,
        list: Array.from(this.loadedModels.keys())
      },
      stats: { ...this.stats },
      systemLoad: { ...this.systemLoad }
    };
  }

  /**
   * 获取任务类型对应的优先级
   */
  _getPriority(type) {
    const priorityMap = {
      'ui': 'P0',
      'hash': 'P1',
      'embedding': 'P2',
      'clip': 'P2',
      'llm': 'P2',
      'model-load': 'P3',
      'model-unload': 'P3'
    };
    return priorityMap[type] || 'P2';
  }

  /**
   * 处理任务队列
   */
  async _processQueues() {
    if (!this.isRunning || this.isPaused) return;

    // 检查系统负载 - 紧急状态处理
    if (this.systemLoad.isCritical) {
      this._emergencyCleanup();
      return;
    }

    // 检查系统负载 - 节流处理
    if (this.options.enableThrottling && this._shouldThrottle()) {
      this.stats.throttledCount++;
      this.emit('scheduler:throttled', this.systemLoad);
      // 延迟后重试
      setTimeout(() => this._processQueues(), this.options.idleDelay);
      return;
    }

    // 检查并发数
    if (this.runningTasks.size >= this.options.maxConcurrency) {
      return;
    }

    // 按优先级获取任务
    const task = this._getNextTask();
    if (!task) return;

    // 执行任务
    this._executeTask(task);

    // 继续处理队列
    setImmediate(() => this._processQueues());
  }

  /**
   * 获取下一个待处理任务（按优先级）
   */
  _getNextTask() {
    for (const priority of ['P0', 'P1', 'P2', 'P3']) {
      const queue = this.queues[priority];
      if (queue.length > 0) {
        return queue.shift();
      }
    }
    return null;
  }

  /**
   * 执行单个任务
   */
  async _executeTask(task) {
    task.status = 'running';
    task.startedAt = Date.now();
    this.runningTasks.set(task.id, task);

    this.emit('task:started', task);

    try {
      // 执行任务
      const result = await task.executor(task.context);

      task.status = 'completed';
      task.completedAt = Date.now();
      task.result = result;
      this.stats.totalCompleted++;

      this.emit('task:completed', task);
      task.resolve(result);

    } catch (error) {
      // 检查是否需要重试
      if (task.retryCount < task.maxRetries && this._shouldRetry(error)) {
        task.retryCount++;
        task.status = 'pending';
        this.runningTasks.delete(task.id);
        this.queues[task.priority].unshift(task); // 放回队列头部
        console.warn(`[TaskScheduler] 任务 ${task.id} 失败，第${task.retryCount}次重试:`, error.message);
        this._processQueues();
        return;
      }

      task.status = 'failed';
      task.completedAt = Date.now();
      task.error = error;
      this.stats.totalFailed++;

      this.emit('task:failed', task, error);
      task.reject(error);

    } finally {
      this.runningTasks.delete(task.id);

      // 继续处理队列
      setImmediate(() => this._processQueues());
    }
  }

  /**
   * 判断是否应该重试
   */
  _shouldRetry(error) {
    // 内存错误可以重试
    if (error.message && error.message.includes('内存')) return true;
    if (error.message && error.message.includes('memory')) return true;
    // 模型加载错误可以重试
    if (error.message && error.message.includes('模型')) return true;
    if (error.message && error.message.includes('model')) return true;
    return false;
  }

  /**
   * 判断是否应该节流（降低处理速度）
   */
  _shouldThrottle() {
    // 如果 CPU 或内存使用率超过阈值，则节流
    return this.systemLoad.cpu > this.options.cpuThreshold ||
           this.systemLoad.memory > this.options.memoryThreshold;
  }

  /**
   * 启动系统监控
   */
  _startSystemMonitor() {
    const monitor = () => {
      // 计算 CPU 使用率
      const currentCpuUsage = os.cpus().map(cpu => cpu.times);
      let totalUsage = 0;
      let totalDelta = 0;

      for (let i = 0; i < currentCpuUsage.length; i++) {
        const current = currentCpuUsage[i];
        const last = this.lastCpuUsage[i];

        const currentTotal = Object.values(current).reduce((a, b) => a + b, 0);
        const lastTotal = Object.values(last).reduce((a, b) => a + b, 0);
        const deltaTotal = currentTotal - lastTotal;
        const deltaIdle = current.idle - last.idle;

        totalDelta += deltaTotal;
        totalUsage += deltaTotal - deltaIdle;
      }

      this.systemLoad.cpu = totalDelta > 0
        ? Math.round((totalUsage / totalDelta) * 100)
        : 0;

      this.lastCpuUsage = currentCpuUsage;

      // 计算内存使用率
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      this.systemLoad.memory = Math.round(((totalMem - freeMem) / totalMem) * 100);

      // 获取堆内存信息
      const heapStats = v8.getHeapStatistics();
      this.systemLoad.heapUsed = Math.round(heapStats.used_heap_size / 1024 / 1024); // MB
      this.systemLoad.heapTotal = Math.round(heapStats.total_heap_size / 1024 / 1024); // MB

      // 判断是否空闲
      this.systemLoad.isIdle = this.systemLoad.cpu < 20 && this.systemLoad.memory < 60;

      // 判断是否紧急状态
      this.systemLoad.isCritical = this.systemLoad.memory >= this.options.memoryCritical;

      this.emit('system:load', this.systemLoad);

      // 紧急状态自动处理
      if (this.systemLoad.isCritical && this.isRunning && !this.isPaused) {
        this._emergencyCleanup();
      }
    };

    // 每秒监控一次
    setInterval(monitor, 1000);
    monitor(); // 立即执行一次
  }

  /**
   * 启动模型空闲监控
   */
  _startModelIdleMonitor() {
    setInterval(() => {
      const now = Date.now();
      for (const [modelName, model] of this.loadedModels) {
        // 如果模型空闲超过阈值且没有引用，卸载它
        if (model.refCount === 0 &&
            now - model.lastUsed > this.options.modelIdleTimeout) {
          console.log(`[TaskScheduler] 模型 ${modelName} 空闲超时，自动卸载`);
          this.unloadModel(modelName);
        }
      }
    }, 60000); // 每分钟检查一次
  }

  /**
   * 等待所有任务完成
   */
  async waitForAll() {
    while (this.runningTasks.size > 0 ||
           this.queues.P0.length > 0 ||
           this.queues.P1.length > 0 ||
           this.queues.P2.length > 0 ||
           this.queues.P3.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * 销毁调度器
   */
  async destroy() {
    this.stop();
    await this.waitForAll();

    // 卸载所有模型
    for (const [modelName] of this.loadedModels) {
      await this.unloadModel(modelName);
    }
  }
}

module.exports = { TaskScheduler };
