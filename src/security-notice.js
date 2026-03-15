/**
 * 安全提示模块
 * 处理杀毒软件白名单提示、权限说明等安全相关功能
 */

const { dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class SecurityNotice {
  constructor() {
    this.settingsPath = this._getSettingsPath();
    this.settings = this._loadSettings();
  }

  /**
   * 获取设置文件路径
   */
  _getSettingsPath() {
    if (app && app.getPath) {
      return path.join(app.getPath('userData'), 'security-settings.json');
    }
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    return path.join(homeDir, '.smart-file-organizer', 'security-settings.json');
  }

  /**
   * 加载设置
   */
  _loadSettings() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (err) {
      console.error('[SecurityNotice] 加载设置失败:', err);
    }
    return {
      whitelistPromptShown: false,
      dontShowAgain: false
    };
  }

  /**
   * 保存设置
   */
  _saveSettings() {
    try {
      const dir = path.dirname(this.settingsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf8');
    } catch (err) {
      console.error('[SecurityNotice] 保存设置失败:', err);
    }
  }

  /**
   * 显示杀毒软件白名单提示
   */
  async showWhitelistPrompt(parentWindow = null) {
    // 如果用户选择不再显示，直接返回
    if (this.settings.dontShowAgain) {
      return { action: 'skipped', reason: 'user_preference' };
    }

    const result = await dialog.showMessageBox(parentWindow, {
      type: 'info',
      title: 'Windows 安全提示',
      message: '请将本应用添加到杀毒软件白名单',
      detail: `智能文件整理器需要执行以下操作，可能会被 Windows Defender 或第三方杀毒软件误判：

• 扫描大量文件（文件去重功能）
• 移动/删除文件（文件整理功能）
• 本地运行 AI 模型（语义搜索功能）

建议操作：
1. 打开 Windows 安全中心
2. 进入"病毒和威胁防护" → "排除项"
3. 添加本应用安装目录到排除项

或者点击"打开设置"按钮，我们将引导您完成设置。`,
      buttons: ['打开 Windows 安全设置', '查看详细帮助', '知道了', '不再提示'],
      defaultId: 2,
      cancelId: 2,
      checkboxLabel: '记住我的选择',
      checkboxChecked: false
    });

    const { response, checkboxChecked } = result;

    // 处理用户选择
    switch (response) {
      case 0: // 打开 Windows 安全设置
        this._openWindowsSecuritySettings();
        break;
      case 1: // 查看详细帮助
        this._openHelpDocumentation();
        break;
      case 3: // 不再提示
        this.settings.dontShowAgain = true;
        this._saveSettings();
        break;
    }

    if (checkboxChecked && response !== 3) {
      this.settings.whitelistPromptShown = true;
      this._saveSettings();
    }

    return { action: 'shown', buttonIndex: response };
  }

  /**
   * 打开 Windows 安全设置
   */
  _openWindowsSecuritySettings() {
    // Windows 10/11 安全中心 URI
    const securityUri = 'ms-settings:windowsdefender';
    shell.openExternal(securityUri).catch(() => {
      // 如果 URI 方案失败，尝试打开控制面板
      shell.openPath('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
        .then(() => {
          // 可以在这里添加 PowerShell 命令来添加排除项
          console.log('[SecurityNotice] 已打开 PowerShell');
        })
        .catch(err => {
          console.error('[SecurityNotice] 无法打开安全设置:', err);
        });
    });
  }

  /**
   * 打开帮助文档
   */
  _openHelpDocumentation() {
    // 创建帮助文档内容
    const helpContent = this._generateHelpHTML();
    const tempPath = path.join(require('os').tmpdir(), 'sfo-security-help.html');
    fs.writeFileSync(tempPath, helpContent, 'utf8');
    shell.openPath(tempPath);
  }

  /**
   * 生成帮助文档 HTML
   */
  _generateHelpHTML() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FileSense AI (灵析) - 安全设置指南</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      background: #f5f5f5;
    }
    .container {
      background: white;
      border-radius: 12px;
      padding: 40px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 {
      color: #1a73e8;
      margin-bottom: 20px;
      font-size: 28px;
    }
    h2 {
      color: #333;
      margin: 30px 0 15px;
      font-size: 20px;
      border-bottom: 2px solid #e0e0e0;
      padding-bottom: 10px;
    }
    .warning-box {
      background: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 15px 20px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .info-box {
      background: #d1ecf1;
      border-left: 4px solid #17a2b8;
      padding: 15px 20px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .step {
      display: flex;
      margin: 20px 0;
      align-items: flex-start;
    }
    .step-number {
      width: 32px;
      height: 32px;
      background: #1a73e8;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      margin-right: 15px;
      flex-shrink: 0;
    }
    .step-content {
      flex: 1;
    }
    .step-content h3 {
      margin-bottom: 8px;
      color: #333;
    }
    .step-content p {
      color: #666;
      margin-bottom: 8px;
    }
    .code-block {
      background: #f8f9fa;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      padding: 12px;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 14px;
      overflow-x: auto;
      margin: 10px 0;
    }
    .antivirus-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin: 20px 0;
    }
    .antivirus-item {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 8px;
      text-align: center;
    }
    .antivirus-item h4 {
      margin-bottom: 8px;
      color: #333;
    }
    .antivirus-item a {
      color: #1a73e8;
      text-decoration: none;
    }
    .antivirus-item a:hover {
      text-decoration: underline;
    }
    footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
      text-align: center;
      color: #999;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🛡️ 安全设置指南</h1>

    <div class="warning-box">
      <strong>⚠️ 为什么需要添加到白名单？</strong><br>
      智能文件整理器需要扫描您的文件系统来查找重复文件，这涉及大量文件 I/O 操作。
      某些杀毒软件可能会将此行为误判为潜在的勒索软件活动。
    </div>

    <h2>Windows Defender 设置步骤</h2>

    <div class="step">
      <div class="step-number">1</div>
      <div class="step-content">
        <h3>打开 Windows 安全中心</h3>
        <p>点击开始菜单，搜索"Windows 安全中心"并打开。</p>
        <p>或者使用快捷键：Win + I → 更新和安全 → Windows 安全中心</p>
      </div>
    </div>

    <div class="step">
      <div class="step-number">2</div>
      <div class="step-content">
        <h3>进入病毒和威胁防护设置</h3>
        <p>点击左侧菜单的"病毒和威胁防护"，然后点击"管理设置"。</p>
      </div>
    </div>

    <div class="step">
      <div class="step-number">3</div>
      <div class="step-content">
        <h3>添加排除项</h3>
        <p>滚动到"排除项"部分，点击"添加或删除排除项"。</p>
        <p>点击"添加排除项" → "文件夹"，然后选择智能文件整理器的安装目录。</p>
        <div class="code-block">默认安装路径：%LOCALAPPDATA%\\Programs\\smart-file-organizer</div>
      </div>
    </div>

    <h2>第三方杀毒软件</h2>

    <div class="antivirus-list">
      <div class="antivirus-item">
        <h4>360安全卫士</h4>
        <p>设置 → 安全防护中心 → 信任与阻止 → 添加信任文件</p>
      </div>
      <div class="antivirus-item">
        <h4>腾讯电脑管家</h4>
        <p>设置中心 → 病毒查杀 → 信任区 → 添加文件</p>
      </div>
      <div class="antivirus-item">
        <h4>火绒安全</h4>
        <p>安全设置 → 病毒防护 → 信任区 → 添加文件夹</p>
      </div>
      <div class="antivirus-item">
        <h4>卡巴斯基</h4>
        <p>设置 → 附加 → 威胁和排除 → 排除项 → 添加</p>
      </div>
    </div>

    <h2>常见问题</h2>

    <div class="info-box">
      <strong>Q: 添加到白名单安全吗？</strong><br>
      A: 是的。智能文件整理器是开源软件，所有代码都经过审查。添加到白名单只是让杀毒软件不监控本应用的正常文件操作，不会影响系统安全。
    </div>

    <div class="info-box">
      <strong>Q: 不添加白名单会怎样？</strong><br>
      A: 应用可能运行缓慢，某些功能（如批量删除）可能被拦截，或者频繁弹出安全警告。
    </div>

    <div class="info-box">
      <strong>Q: 如何确认应用没有被篡改？</strong><br>
      A: 您可以通过 GitHub 查看源代码，或者使用数字签名验证安装包的完整性。
    </div>

    <footer>
      <p>智能文件整理器 v1.0 | 本地优先，隐私至上</p>
      <p>如有问题，请访问我们的 GitHub 页面获取支持</p>
    </footer>
  </div>
</body>
</html>`;
  }

  /**
   * 检查是否需要显示提示
   */
  shouldShowPrompt() {
    // 首次启动时显示
    if (!this.settings.whitelistPromptShown) {
      return true;
    }
    // 如果用户选择不再显示，则不显示
    if (this.settings.dontShowAgain) {
      return false;
    }
    return false;
  }

  /**
   * 重置提示设置（用于测试）
   */
  resetSettings() {
    this.settings = {
      whitelistPromptShown: false,
      dontShowAgain: false
    };
    this._saveSettings();
  }

  /**
   * 显示性能警告（当检测到扫描速度异常时）
   */
  async showPerformanceWarning(parentWindow = null) {
    const result = await dialog.showMessageBox(parentWindow, {
      type: 'warning',
      title: '扫描速度较慢',
      message: '检测到文件扫描速度异常',
      detail: `扫描速度明显低于预期，这可能是由于：

1. 杀毒软件正在实时监控文件访问
2. 磁盘 I/O 性能受限
3. 其他程序占用大量系统资源

建议：
• 将本应用添加到杀毒软件白名单
• 关闭不必要的后台程序
• 检查磁盘健康状况`,
      buttons: ['查看白名单设置', '继续扫描', '取消扫描'],
      defaultId: 1
    });

    if (response === 0) {
      this.showWhitelistPrompt(parentWindow);
    }

    return result.response;
  }
}

// 单例模式
let instance = null;

function getSecurityNotice() {
  if (!instance) {
    instance = new SecurityNotice();
  }
  return instance;
}

module.exports = {
  SecurityNotice,
  getSecurityNotice
};
