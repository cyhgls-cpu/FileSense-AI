# 🔍 模型下载链接测试报告

## 📋 测试方法

### 方法一：浏览器测试（推荐）

1. **运行测试工具**
   ```bash
   # Windows
   run-link-test.bat
   
   # 或双击 test-download-links.html
   ```

2. **在打开的页面中**
   - 点击 "▶️ 开始测试" 按钮
   - 等待所有链接自动测试完成
   - 查看测试结果汇总

### 方法二：手动测试

直接在浏览器中打开以下链接，检查是否能正常下载：

#### EMBEDDING 模型 (22MB)
- ✅ **ModelScope（阿里云）**: https://www.modelscope.cn/models/iic/bge-micro-v2/resolve/master/model.onnx
- ✅ **Modelers.cn（智谱 AI）**: https://modelers.cn/models/BAAI/bge-micro-v2/resolve/main/model.onnx
- 🌐 **HuggingFace**: https://huggingface.co/BAAI/bge-micro-v2/resolve/main/model.onnx

#### CLIP 模型 (150MB)
- ✅ **ModelScope（阿里云）**: https://www.modelscope.cn/models/damo/cv_vit-base-patch32_image-multimodal-embedding/resolve/master/model.onnx
- ✅ **Modelers.cn（智谱 AI）**: https://modelers.cn/models/openai/clip-vit-base-patch32/resolve/main/model.onnx
- 🌐 **HuggingFace**: https://huggingface.co/openai/clip-vit-base-patch32/resolve/main/model.onnx

#### LLM 模型 (1.1GB)
- ✅ **ModelScope（阿里云）**: https://www.modelscope.cn/models/qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/master/qwen2.5-1.5b-instruct-q4_k_m.gguf
- ✅ **Modelers.cn（智谱 AI）**: https://modelers.cn/models/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf
- 🌐 **HuggingFace**: https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf

---

## ✅ 预期结果

### 国内镜像源（应该全部可用）

| 镜像源 | 状态 | 说明 |
|--------|------|------|
| ModelScope（阿里云） | ✅ 可用 | 国内最快，推荐优先使用 |
| Modelers.cn（智谱 AI） | ✅ 可用 | 备用选择，速度也很快 |

### 国际镜像源（可能不稳定）

| 镜像源 | 状态 | 说明 |
|--------|------|------|
| HuggingFace | ⚠️ 可能失败 | 需要代理或网络状况良好 |

---

## 🎯 推荐下载顺序

1. **优先尝试**: ModelScope（阿里云）- 红色渐变按钮
2. **备选方案**: Modelers.cn（智谱 AI）- 蓝色渐变按钮  
3. **最后选择**: HuggingFace - 紫色渐变按钮（可能需要代理）

---

## 📊 测试结果记录

### 测试时间
> 在此记录测试日期：_______________

### EMBEDDING 模型
- [ ] ModelScope: ✅ / ❌
- [ ] Modelers.cn: ✅ / ❌
- [ ] HuggingFace: ✅ / ❌

### CLIP 模型
- [ ] ModelScope: ✅ / ❌
- [ ] Modelers.cn: ✅ / ❌
- [ ] HuggingFace: ✅ / ❌

### LLM 模型
- [ ] ModelScope: ✅ / ❌
- [ ] Modelers.cn: ✅ / ❌
- [ ] HuggingFace: ✅ / ❌

---

## 💡 故障排除

### 如果所有链接都失败

**可能原因：**
- 网络连接问题
- DNS 解析失败
- 防火墙阻止

**解决方案：**
1. 检查网络连接
2. 尝试更换 DNS（如 8.8.8.8 或 1.1.1.1）
3. 暂时关闭防火墙测试

### 如果只有 HuggingFace 失败

**这是正常现象！** 请使用国内镜像源：
- ModelScope（阿里云）通常是最快的
- Modelers.cn（智谱 AI）作为备用

### 如果下载速度慢

1. **避开高峰时段**: 晚上 8-10 点可能较慢
2. **使用浏览器下载**: 支持断点续传
3. **多线程下载器**: 如 IDM、FDM 等

---

## 📝 下载后操作

1. **重命名文件**（根据模型类型）：
   - EMBEDDING: `bge-micro-v2.onnx`
   - CLIP: `clip-vit-b-32.onnx`
   - LLM: `qwen2.5-1.5b-instruct-q4_k_m.gguf`

2. **放到 models 文件夹**：
   ```
   k:\AI soft\rerere\models\
   ```

3. **重启应用并加载模型**

---

## 📧 反馈

如果某个链接持续不可用，请记录：
- 链接地址：________________
- 错误信息：________________
- 测试时间：________________

这将帮助我们更新镜像源配置。
