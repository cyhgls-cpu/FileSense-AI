# GitHub 仓库设置指南

## 1. 在 GitHub 创建仓库

1. 登录 GitHub
2. 点击右上角 "+" → "New repository"
3. 填写信息：
   - Repository name: `filesense-ai`
   - Description: `FileSense AI (灵析) - AI驱动的本地文件智能整理助手`
   - Public (推荐开源)
   - 不要勾选 "Initialize this repository with a README"（已有 README）
4. 点击 "Create repository"

## 2. 推送本地代码到 GitHub

### 方式一：HTTPS

```bash
cd "k:/AI soft/rerere"

# 添加远程仓库（替换 yourusername 为你的 GitHub 用户名）
git remote add origin https://github.com/yourusername/filesense-ai.git

# 推送代码
git branch -M main
git push -u origin main
```

### 方式二：SSH（推荐）

```bash
cd "k:/AI soft/rerere"

# 添加远程仓库（替换 yourusername 为你的 GitHub 用户名）
git remote add origin git@github.com:yourusername/filesense-ai.git

# 推送代码
git branch -M main
git push -u origin main
```

## 3. 创建标签触发自动打包

```bash
# 创建版本标签
git tag v1.0.0

# 推送标签到 GitHub（触发 GitHub Actions 自动打包）
git push origin v1.0.0
```

## 4. 验证 GitHub Actions

1. 推送标签后，进入 GitHub 仓库
2. 点击 "Actions" 标签
3. 查看 "Build and Release" 工作流是否运行
4. 等待约 10-15 分钟，所有平台打包完成
5. 点击 "Releases" 查看自动发布的安装包

## 5. 后续更新代码

```bash
# 修改代码后
git add -A
git commit -m "描述你的更改"
git push origin main

# 发布新版本
git tag v1.0.1
git push origin v1.0.1
```

## 常见问题

### 1. 推送被拒绝
```bash
# 先拉取远程更改
git pull origin main --rebase
# 然后再推送
git push origin main
```

### 2. 大文件推送失败
项目中的截图文件较大，如果推送失败：
```bash
# 安装 Git LFS
git lfs install

# 追踪大文件
git lfs track "docs/*.png"
git lfs track "assets/*.png"
git lfs track "assets/*.jpg"

# 重新提交推送
git add .gitattributes
git commit -m "Add Git LFS for large files"
git push origin main
```

### 3. GitHub Actions 打包失败
查看 Actions 日志，常见问题：
- 依赖安装失败 → 检查 package.json
- 权限不足 → 检查仓库 Settings → Actions permissions
- 签名失败 → 正常，开源项目不需要代码签名

## 文件说明

已准备好的文件：
- ✅ `.gitignore` - 忽略 node_modules 等文件
- ✅ `LICENSE` - MIT 开源协议
- ✅ `README.md` - 项目介绍
- ✅ `.github/workflows/build.yml` - 自动打包配置
- ✅ Git 仓库已初始化并提交

只需执行上面的推送命令即可！
