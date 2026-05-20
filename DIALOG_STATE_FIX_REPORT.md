# 对话框状态同步问题 - 修复报告

## 问题描述
打开对话框时，对话框中的选择状态和实际时不同步。

## 根本原因

### 问题1：s-switch组件的checked属性不同步
在HTML中使用属性方式设置initial state：
```html
<s-switch id="switch-${subject.id}" ${!subject.isDeleted ? 'checked' : ''}></s-switch>
```

这种方法对Web Components可能不可靠，因为Web Components需要在JavaScript中设置属性。

### 问题2：打开添加科目对话框时没有清空表单
每次打开对话框时，前一次的输入内容和选择状态仍然保留，导致用户看到旧的数据。

## 修复方案

### 修复1：在JavaScript中正确设置s-switch的checked属性
```javascript
// 移除HTML中的checked属性
<s-switch id="switch-${subject.id}"></s-switch>

// 在JavaScript中动态设置
const switchEl = itemDiv.querySelector(`#switch-${subject.id}`);
if (switchEl) {
    // 设置初始状态
    switchEl.checked = !subject.isDeleted;
    // 绑定change事件
    switchEl.addEventListener('change', () => {
        subject.isDeleted = !switchEl.checked;
        saveState();
        renderUI();
    });
}
```

**效果**：
- ✅ 打开对话框时，开关状态正确反映科目的显示/隐藏状态
- ✅ 切换开关时，状态立即同步到实际数据

### 修复2：打开添加科目对话框时清空表单
```javascript
function openAddSubjectDialog() {
    // 重置表单状态
    const nameInput = document.getElementById('new-subject-name');
    const iconPicker = document.getElementById('new-subject-icon');
    
    if (nameInput) nameInput.value = '';
    if (iconPicker) iconPicker.value = '';
    
    const dialog = document.getElementById('add-subject-dialog');
    if (dialog) {
        dialog.showed = true;
    }
}
```

**效果**：
- ✅ 每次打开添加科目对话框时，输入框都是空的
- ✅ 图标选择器也被重置为无选择状态
- ✅ 用户不会被前一次的输入困惑

## 修改的代码位置

### src/main.js

#### 修改1：渲染科目管理对话框
- **行号**：约193-270行
- **改动**：
  - 移除HTML中的`${!subject.isDeleted ? 'checked' : ''}`
  - 添加JavaScript中的`switchEl.checked = !subject.isDeleted;`

#### 修改2：打开添加科目对话框
- **行号**：约331-339行
- **改动**：
  - 添加表单清空逻辑

## 测试结果

✅ **代码编译**：npm run build成功，无错误
✅ **页面加载**：没有报错
✅ **对话框打开**：科目管理对话框正常打开
✅ **表单清空**：添加科目对话框每次打开都是空的
✅ **状态同步**：开关状态与实际数据同步

## 使用验证

### 验证步骤
1. 点击右下角菜单 → "管理科目"
2. 验证所有科目都显示在列表中
3. 开关状态应该都是"开启"（因为所有科目都没被删除）
4. 点击开关关闭某个科目
5. 主看板上该科目应该立即隐藏
6. 再打开科目管理对话框，该科目的开关应该仍然是关闭状态
7. 点击"添加新科目"按钮
8. 输入框和图标选择器应该都是空的
9. 取消操作，再次打开，仍然是空的

## 性能影响
- 无额外性能开销
- 代码更简洁，逻辑更清晰
- Web Components的属性设置方式更标准

## 向后兼容性
✅ 完全兼容现有数据
✅ 无需迁移任何数据
✅ 可以直接部署到生产环境

## 结论
通过在JavaScript中正确设置Web Components的属性，以及在打开对话框时清空表单状态，成功解决了对话框选择状态不同步的问题。修复简单有效，并通过了初步测试。
