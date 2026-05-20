# 科目管理功能 - 技术实现细节

## 文件修改概览

### 修改的文件
1. **index.html** - 添加UI对话框和组件
2. **src/main.js** - 实现核心逻辑和事件处理

## HTML 结构

### 新增对话框

#### 1. 科目管理对话框（subject-manage-dialog）
```html
<s-dialog id="subject-manage-dialog" size="standard">
  <div slot="headline">科目管理</div>
  <div slot="text">
    <div id="subject-list-container">
      <!-- 动态生成的科目列表 -->
    </div>
    <div style="margin-top: 16px; padding-top: 16px; border-top: ...">
      <s-button id="add-subject-btn" type="filled">
        <!-- 添加科目按钮 -->
      </s-button>
    </div>
  </div>
  <s-button slot="action" type="text" id="subject-manage-close">关闭</s-button>
</s-dialog>
```

#### 2. 添加科目对话框（add-subject-dialog）
```html
<s-dialog id="add-subject-dialog">
  <div slot="headline">添加科目</div>
  <div slot="text">
    <s-text-field id="new-subject-name" label="科目名称"></s-text-field>
    <s-picker id="new-subject-icon" label="选择图标">
      <s-picker-item value="assets/chinese.svg">语文</s-picker-item>
      <!-- 其他预设图标 -->
    </s-picker>
  </div>
  <s-button slot="action" type="text" id="add-subject-cancel">取消</s-button>
  <s-button slot="action" type="text" id="add-subject-confirm">确定</s-button>
</s-dialog>
```

## JavaScript 实现

### 核心函数

#### 1. `renderSubjectManageDialog()` - 异步函数
**功能**：渲染科目列表

**流程**：
1. 清空容器
2. 遍历appState中的所有科目
3. 为每个科目创建列表项
4. 绑定事件监听器（拖动、开关、删除）
5. 调用replaceIconMasks替换SVG图标

**关键特性**：
- 支持Drag & Drop API
- 动态ID生成（使用科目ID）
- 使用Material Design 3 CSS变量
- 异步处理确保图标正确加载

#### 2. `openSubjectManageDialog()` - 异步函数
**功能**：打开科目管理对话框

**流程**：
1. 等待renderSubjectManageDialog完成
2. 设置dialog.showed = true

#### 3. 拖动排序逻辑
```javascript
dragstart → 保存被拖动项
dragover  → 预览位置（显示边框）
dragleave → 清除预览
drop      → 交换数据并保存
dragend   → 清理状态
```

### 数据结构

#### Subject对象
```javascript
{
  id: string,           // 唯一标识（s1-s9或subject_timestamp）
  name: string,         // 科目名称
  icon: string,         // 图标URL
  content: string,      // 科目内容（富文本HTML）
  isDeleted: boolean    // 隐藏状态（用于显示/隐藏）
}
```

### 事件处理链

```
菜单项点击
  ↓
openSubjectManageDialog()
  ↓
renderSubjectManageDialog()
  ↓
绑定所有事件监听器
  ├─ dragstart/dragend/dragover/dragleave/drop (拖动排序)
  ├─ s-switch change事件 (显示/隐藏)
  └─ 删除按钮click事件
```

## CSS 变量使用

使用SoberUI的Material Design 3 CSS变量：

| 用途 | 变量 | 回退值 |
|------|------|--------|
| 背景色 | `--s-color-surface-variant` | `#FAE4E7` |
| 文字色 | `--s-color-on-surface` | `#3E1914` |
| 错误色 | `--s-color-error` | `#d32f2f` |
| 主色 | `--s-color-primary` | `#FFA3B1` |

## 关键改动

### 1. 移除恢复面板（restore-panel）
原来的恢复面板用于显示已删除的科目，现在改为使用管理对话框中的开关来控制。

**原逻辑**：
```javascript
if (subject.isDeleted) {
  // 在restore-panel中创建按钮
}
```

**新逻辑**：
```javascript
// 所有科目都在管理对话框中显示
// 使用开关控制isDeleted属性
```

### 2. 删除方式改变
- **原来**：使用删除按钮标记isDeleted = true（可恢复）
- **现在**：完全从appState中移除（不可恢复）

### 3. UI组件的使用
- **原来**：自定义HTML和样式
- **现在**：全部使用SoberUI组件
  - `<s-switch>` 替代复选框
  - `<s-icon-button>` 替代简单按钮
  - `<s-dialog>` 替代原有对话框

## 性能优化

1. **异步图标替换**：使用await确保图标正确加载
2. **事件委托**：每个科目项单独绑定事件，避免重复
3. **DOM复用**：拖动时只修改样式，不重新渲染整个DOM
4. **自动保存**：每次操作后立即保存到localStorage

## 兼容性

- **浏览器**：支持Drag & Drop API的现代浏览器
  - Chrome 4+
  - Firefox 3.6+
  - Safari 3.1+
  - Edge 12+
- **响应式**：适配各种屏幕尺寸（通过dialog的响应式设计）

## 未来可能的改进

1. 支持编辑科目名称和图标
2. 拖动时更动画效果
3. 撤销/重做功能
4. 导入/导出科目配置
5. 科目分组功能
6. 自定义图标上传
