/**
 * 虚拟滚动组件 - Virtual Scroller
 * 解决Electron渲染大量DOM节点导致的性能问题
 * 无论数据量多大，只渲染视口可见的节点
 */

class VirtualScroller {
  constructor(options) {
    this.container = options.container; // 容器元素
    this.itemHeight = options.itemHeight || 60; // 每项高度
    this.itemCount = options.itemCount || 0; // 总项目数
    this.renderFn = options.renderFn; // 渲染函数(item, index) => HTMLElement
    this.bufferSize = options.bufferSize || 5; // 上下缓冲数量

    this.scrollTop = 0;
    this.visibleStart = 0;
    this.visibleEnd = 0;
    this.items = new Map(); // 缓存已渲染的项目

    this._init();
  }

  _init() {
    // 创建内部结构
    this.viewport = document.createElement('div');
    this.viewport.className = 'virtual-scroll-viewport';
    this.viewport.style.position = 'relative';
    this.viewport.style.overflow = 'auto';
    this.viewport.style.height = '100%';

    this.content = document.createElement('div');
    this.content.className = 'virtual-scroll-content';
    this.content.style.position = 'relative';

    this.viewport.appendChild(this.content);

    // 清空容器并添加视口
    this.container.innerHTML = '';
    this.container.appendChild(this.viewport);

    // 绑定滚动事件
    this.viewport.addEventListener('scroll', this._onScroll.bind(this), { passive: true });

    // 初始渲染
    this._updateDimensions();
    this._render();

    // 监听容器大小变化
    this.resizeObserver = new ResizeObserver(() => {
      this._updateDimensions();
      this._render();
    });
    this.resizeObserver.observe(this.container);
  }

  _updateDimensions() {
    const containerHeight = this.viewport.clientHeight;
    this.visibleCount = Math.ceil(containerHeight / this.itemHeight) + this.bufferSize * 2;
    this.totalHeight = this.itemCount * this.itemHeight;
    this.content.style.height = `${this.totalHeight}px`;
  }

  _onScroll() {
    this.scrollTop = this.viewport.scrollTop;
    requestAnimationFrame(() => this._render());
  }

  _render() {
    const start = Math.floor(this.scrollTop / this.itemHeight);
    const visibleStart = Math.max(0, start - this.bufferSize);
    const visibleEnd = Math.min(this.itemCount, start + this.visibleCount);

    // 如果范围没有变化，跳过渲染
    if (visibleStart === this.visibleStart && visibleEnd === this.visibleEnd) {
      return;
    }

    this.visibleStart = visibleStart;
    this.visibleEnd = visibleEnd;

    // 清理不在视口内的元素
    for (const [index, element] of this.items) {
      if (index < visibleStart || index >= visibleEnd) {
        element.remove();
        this.items.delete(index);
      }
    }

    // 渲染可见项目
    for (let i = visibleStart; i < visibleEnd; i++) {
      if (!this.items.has(i)) {
        const element = this.renderFn(i);
        if (element) {
          element.style.position = 'absolute';
          element.style.top = `${i * this.itemHeight}px`;
          element.style.left = '0';
          element.style.right = '0';
          element.style.height = `${this.itemHeight}px`;
          element.dataset.index = i;
          this.content.appendChild(element);
          this.items.set(i, element);
        }
      }
    }
  }

  // 更新数据
  updateData(newCount) {
    this.itemCount = newCount;
    this._updateDimensions();

    // 清理所有缓存
    for (const element of this.items.values()) {
      element.remove();
    }
    this.items.clear();

    this._render();
  }

  // 滚动到指定索引
  scrollToIndex(index, behavior = 'smooth') {
    const top = index * this.itemHeight;
    this.viewport.scrollTo({ top, behavior });
  }

  // 获取可见范围内的索引
  getVisibleRange() {
    return { start: this.visibleStart, end: this.visibleEnd };
  }

  // 销毁
  destroy() {
    this.resizeObserver?.disconnect();
    this.viewport.removeEventListener('scroll', this._onScroll);
    this.container.innerHTML = '';
  }
}

/**
 * 可变高度虚拟滚动 - 用于高度不一致的列表（如重复文件卡片）
 */
class DynamicVirtualScroller {
  constructor(options) {
    this.container = options.container;
    this.estimateHeight = options.estimateHeight || 200; // 预估高度
    this.itemCount = options.itemCount || 0;
    this.renderFn = options.renderFn; // (index) => { element, height }
    this.bufferSize = options.bufferSize || 3;

    this.scrollTop = 0;
    this.heights = new Map(); // 存储实际高度
    this.items = new Map();
    this.cumulativeHeights = [0]; // 累积高度缓存

    this._init();
  }

  _init() {
    this.viewport = document.createElement('div');
    this.viewport.className = 'dynamic-virtual-scroll-viewport';
    this.viewport.style.position = 'relative';
    this.viewport.style.overflow = 'auto';
    this.viewport.style.height = '100%';

    this.content = document.createElement('div');
    this.content.className = 'dynamic-virtual-scroll-content';
    this.content.style.position = 'relative';

    this.viewport.appendChild(this.content);
    this.container.innerHTML = '';
    this.container.appendChild(this.viewport);

    this.viewport.addEventListener('scroll', this._onScroll.bind(this), { passive: true });

    this._updateDimensions();
    this._render();

    this.resizeObserver = new ResizeObserver(() => {
      this._updateDimensions();
      this._render();
    });
    this.resizeObserver.observe(this.container);
  }

  _getCumulativeHeight(index) {
    if (index <= 0) return 0;
    if (this.cumulativeHeights[index] !== undefined) {
      return this.cumulativeHeights[index];
    }

    // 计算累积高度
    let height = this.cumulativeHeights[this.cumulativeHeights.length - 1] || 0;
    for (let i = this.cumulativeHeights.length; i <= index; i++) {
      height += this.heights.get(i - 1) || this.estimateHeight;
      this.cumulativeHeights[i] = height;
    }
    return height;
  }

  _getTotalHeight() {
    return this._getCumulativeHeight(this.itemCount);
  }

  _findIndexAtScroll(scrollTop) {
    // 二分查找对应的索引
    let left = 0;
    let right = this.itemCount;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      const height = this._getCumulativeHeight(mid);
      if (height < scrollTop) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    return left;
  }

  _updateDimensions() {
    const totalHeight = this._getTotalHeight();
    this.content.style.height = `${totalHeight}px`;
  }

  _onScroll() {
    this.scrollTop = this.viewport.scrollTop;
    requestAnimationFrame(() => this._render());
  }

  _render() {
    const start = this._findIndexAtScroll(this.scrollTop);
    const containerHeight = this.viewport.clientHeight;
    let end = start;
    let currentHeight = 0;

    // 找到视口结束索引
    while (end < this.itemCount && currentHeight < containerHeight + this.estimateHeight * this.bufferSize) {
      currentHeight += this.heights.get(end) || this.estimateHeight;
      end++;
    }

    const visibleStart = Math.max(0, start - this.bufferSize);
    const visibleEnd = Math.min(this.itemCount, end + this.bufferSize);

    // 清理不在视口内的元素
    for (const [index, element] of this.items) {
      if (index < visibleStart || index >= visibleEnd) {
        // 保存实际高度
        if (element.offsetHeight > 0) {
          this.heights.set(index, element.offsetHeight);
        }
        element.remove();
        this.items.delete(index);
      }
    }

    // 渲染可见项目
    for (let i = visibleStart; i < visibleEnd; i++) {
      if (!this.items.has(i)) {
        const result = this.renderFn(i);
        if (result) {
          const element = result.element || result;
          const top = this._getCumulativeHeight(i);

          element.style.position = 'absolute';
          element.style.top = `${top}px`;
          element.style.left = '0';
          element.style.right = '0';
          element.dataset.index = i;

          this.content.appendChild(element);
          this.items.set(i, element);

          // 如果提供了高度，使用它
          if (result.height) {
            this.heights.set(i, result.height);
          }
        }
      }
    }

    // 更新累积高度缓存
    this._updateDimensions();
  }

  updateData(newCount) {
    this.itemCount = newCount;
    this.heights.clear();
    this.cumulativeHeights = [0];

    for (const element of this.items.values()) {
      element.remove();
    }
    this.items.clear();

    this._updateDimensions();
    this._render();
  }

  scrollToIndex(index, behavior = 'smooth') {
    const top = this._getCumulativeHeight(index);
    this.viewport.scrollTo({ top, behavior });
  }

  refreshItem(index) {
    // 强制刷新指定索引的项目
    const element = this.items.get(index);
    if (element) {
      this.heights.set(index, element.offsetHeight);
      element.remove();
      this.items.delete(index);
      this._render();
    }
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.viewport.removeEventListener('scroll', this._onScroll);
    this.container.innerHTML = '';
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VirtualScroller, DynamicVirtualScroller };
}
