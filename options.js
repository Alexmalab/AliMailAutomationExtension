// options.js - 规则管理页面的JavaScript

const rulesListBody = document.querySelector('#rulesList tbody');
const ruleModal = document.getElementById('ruleModal');
const detailModal = document.getElementById('detailModal');
const closeButtons = document.querySelectorAll('.close-button');
const ruleForm = document.getElementById('ruleForm');
const modalTitle = document.getElementById('modalTitle');

// 表单元素
const ruleIdInput = document.getElementById('ruleId');
const ruleNameInput = document.getElementById('ruleName');
const ruleEnabledCheckbox = document.getElementById('ruleEnabled');
const cancelButton = document.querySelector('.cancel-btn');
const normalRuleActions = document.getElementById('normalRuleActions');

// 主题条件元素
const subjectConditionToggle = document.getElementById('subjectConditionToggle');
const subjectConditionType = document.getElementById('subjectConditionType');
const subjectKeywordsContainer = document.getElementById('subjectKeywordsContainer');
const subjectCaseSensitiveCheckbox = document.getElementById('subjectCaseSensitive');

// 发件人条件元素
const senderConditionToggle = document.getElementById('senderConditionToggle');
const senderConditionType = document.getElementById('senderConditionType');
const senderAddressInput = document.getElementById('senderAddress');
const senderCaseSensitiveCheckbox = document.getElementById('senderCaseSensitive');

// 收件人条件元素
const recipientConditionToggle = document.getElementById('recipientConditionToggle');
const recipientConditionType = document.getElementById('recipientConditionType');
const recipientAddressInput = document.getElementById('recipientAddress');
const recipientCaseSensitiveCheckbox = document.getElementById('recipientCaseSensitive');

// 抄送条件元素
const ccConditionToggle = document.getElementById('ccConditionToggle');
const ccConditionType = document.getElementById('ccConditionType');
const ccAddressInput = document.getElementById('ccAddress');
const ccCaseSensitiveCheckbox = document.getElementById('ccCaseSensitive');

// 正文条件元素
const bodyConditionToggle = document.getElementById('bodyConditionToggle');
const bodyConditionType = document.getElementById('bodyConditionType');
const bodyKeywordsContainer = document.getElementById('bodyKeywordsContainer');
const bodyCaseSensitiveCheckbox = document.getElementById('bodyCaseSensitive');
const bodyKeywordLogicOr = document.querySelector('input[name="bodyKeywordLogic"][value="or"]');
const bodyKeywordLogicAnd = document.querySelector('input[name="bodyKeywordLogic"][value="and"]');

// 操作元素
const moveToFolderAction = document.getElementById('moveToFolderAction');
const folderSelect = document.getElementById('folderSelect');
const setLabelAction = document.getElementById('setLabelAction');
const markReadAction = document.getElementById('markReadAction');
const stopProcessingAction = document.getElementById('stopProcessingAction');

// 标签选择相关元素
const tagSelect = document.getElementById('tagSelect');
const tagDropdown = document.getElementById('tagDropdown');
let selectedTags = new Set();

// 缓存标签和文件夹数据
let availableTags = {};
let availableFolders = {};

// ===============================================
// UI 辅助函数
// ===============================================

function showModal(modalElement) {
    modalElement.style.display = 'block';
}

function hideModal(modalElement) {
    modalElement.style.display = 'none';
}

function clearForm() {
    ruleForm.reset();
    ruleIdInput.value = '';
    modalTitle.textContent = '新建收信规则';
    ruleEnabledCheckbox.checked = true; // 默认启用

    // 重置主题条件相关
    subjectConditionToggle.checked = false;
    toggleConditionFields('subject', false);
    clearKeywordsContainer(subjectKeywordsContainer);
    populateKeywordsContainer(subjectKeywordsContainer, []); // 使用新的方法初始化

    // 重置发件人条件相关
    senderConditionToggle.checked = false;
    toggleConditionFields('sender', false);
    senderAddressInput.value = '';

    // 重置收件人条件相关
    recipientConditionToggle.checked = false;
    toggleConditionFields('recipient', false);
    recipientAddressInput.value = '';

    // 重置抄送条件相关
    ccConditionToggle.checked = false;
    toggleConditionFields('cc', false);
    ccAddressInput.value = '';

    // 重置正文条件相关
    bodyConditionToggle.checked = false;
    toggleConditionFields('body', false);
    clearKeywordsContainer(bodyKeywordsContainer);
    populateKeywordsContainer(bodyKeywordsContainer, []); // 使用新的方法初始化

    // 重置操作
    const normalRuleRadio = document.querySelector('input[name="actionType"][value="normal"]');
    normalRuleRadio.checked = true;
    normalRuleActions.style.display = 'block';
    moveToFolderAction.checked = false;
    folderSelect.disabled = true;
    setLabelAction.checked = false;
    markReadAction.checked = false;
    folderSelect.value = '';
    
    // 重置标签选择
    tagSelect.classList.add('disabled');
    clearTags();

    // 重置停止处理其他规则选项
    stopProcessingAction.checked = true; // 默认勾选
}

function toggleConditionFields(conditionType, enabled) {
    if (conditionType === 'subject') {
        subjectConditionType.disabled = !enabled;
        subjectCaseSensitiveCheckbox.disabled = !enabled;
        
        // 切换关键字输入框和按钮状态
        subjectKeywordsContainer.querySelectorAll('input, button, select').forEach(element => {
            element.disabled = !enabled;
        });
        
        if (enabled && subjectKeywordsContainer.children.length === 0) {
            addKeywordInput(subjectKeywordsContainer, '', 'or', true);
        }
    } else if (conditionType === 'body') {
        bodyConditionType.disabled = !enabled;
        bodyCaseSensitiveCheckbox.disabled = !enabled;
        
        // 切换关键字输入框和按钮状态
        bodyKeywordsContainer.querySelectorAll('input, button, select').forEach(element => {
            element.disabled = !enabled;
        });
        
        if (enabled && bodyKeywordsContainer.children.length === 0) {
            addKeywordInput(bodyKeywordsContainer, '', 'or', true);
        }
    } else if (conditionType === 'sender') {
        senderConditionType.disabled = !enabled;
        senderAddressInput.disabled = !enabled;
        senderCaseSensitiveCheckbox.disabled = !enabled;
    } else if (conditionType === 'recipient') {
        recipientConditionType.disabled = !enabled;
        recipientAddressInput.disabled = !enabled;
        recipientCaseSensitiveCheckbox.disabled = !enabled;
    } else if (conditionType === 'cc') {
        ccConditionType.disabled = !enabled;
        ccAddressInput.disabled = !enabled;
        ccCaseSensitiveCheckbox.disabled = !enabled;
    }
}

function clearKeywordsContainer(container) {
    container.innerHTML = '';
}

function addKeywordInput(container, value = '', logic = 'or', isLast = true) {
    // 检查是否有空的关键字输入框
    const hasEmptyKeyword = Array.from(container.querySelectorAll('.keyword-item input[type="text"]'))
        .some(input => !input.value.trim());
    
    if (hasEmptyKeyword && !value) {
        return; // 如果有空的关键字输入框且不是在填充已有值，则不添加新的
    }

    const div = document.createElement('div');
    div.className = 'keyword-item';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '关键字';
    input.value = value;
    input.disabled = !getConditionToggleState(container);

    // Create logic selector element if needed, but defer appending
    let logicSelectElement = null;
    if (!isLast) {
        logicSelectElement = document.createElement('select');
        logicSelectElement.disabled = !getConditionToggleState(container);
        logicSelectElement.innerHTML = '<option value="or">或</option><option value="and">且</option>';
        logicSelectElement.value = logic;
        // Original div.appendChild(logicSelect) is removed from here
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.title = '删除关键字';
    removeBtn.disabled = !getConditionToggleState(container);
    removeBtn.addEventListener('click', () => {
        // 如果只有一个关键字，不允许删除
        if (container.querySelectorAll('.keyword-item').length <= 1) {
            return;
        }
        div.remove();
        // 重新调整最后一个关键字的逻辑连接符显示
        updateLastKeywordItem(container);
    });

    // Append elements in the correct order: input, then logic selector (if it exists), then remove button
    div.appendChild(input);
    if (logicSelectElement) {
        div.appendChild(logicSelectElement);
    }
    div.appendChild(removeBtn);
    container.appendChild(div);
}

function updateLastKeywordItem(container) {
    const items = container.querySelectorAll('.keyword-item');
    items.forEach((item, index) => {
        const logicSelect = item.querySelector('select');
        const isLastItem = index === items.length - 1;
        
        if (isLastItem && logicSelect) {
            // 最后一个应该移除逻辑连接符
            logicSelect.remove();
        } else if (!isLastItem && !logicSelect) {
            // 不是最后一个但没有逻辑连接符，需要添加
            const input = item.querySelector('input[type="text"]');
            const removeBtn = item.querySelector('button');
            const newLogicSelect = document.createElement('select');
            newLogicSelect.disabled = !getConditionToggleState(container);
            newLogicSelect.innerHTML = '<option value="or">或</option><option value="and">且</option>';
            newLogicSelect.value = 'or';
            item.insertBefore(newLogicSelect, removeBtn);
        }
    });
}

function addKeywordGroup(container) {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'add-keyword-btn';
    addBtn.textContent = '+';
    addBtn.title = '添加关键字';
    addBtn.disabled = !getConditionToggleState(container);
    addBtn.addEventListener('click', () => {
        // 移除旧的添加按钮
        addBtn.remove();
        // 添加新的关键字输入框（不是最后一个）
        addKeywordInput(container, '', 'or', false);
        // 更新所有关键字项的连接符显示
        updateLastKeywordItem(container);
        // 重新添加添加按钮
        addKeywordGroup(container);
    });
    container.appendChild(addBtn);
}

function getConditionToggleState(container) {
    if (container === bodyKeywordsContainer) {
        return bodyConditionToggle.checked;
    } else if (container === subjectKeywordsContainer) {
        return subjectConditionToggle.checked;
    } else if (container === senderAddressInput) { // Assuming senderAddressInput is unique enough
        return senderConditionToggle.checked;
    } else if (container === recipientAddressInput) { // Assuming recipientAddressInput is unique enough
        return recipientConditionToggle.checked;
    } else if (container === ccAddressInput) { 
        return ccConditionToggle.checked;
    }
    return false;
}

function getKeywordsFromContainer(container) {
    const items = container.querySelectorAll('.keyword-item');
    const result = [];
    
    items.forEach((item, index) => {
        const input = item.querySelector('input[type="text"]');
        const logicSelect = item.querySelector('select');
        const keyword = input.value.trim();
        
        if (keyword !== '') {
            const keywordData = { keyword: keyword };
            
            // 如果不是最后一个，添加逻辑连接符
            if (index < items.length - 1 && logicSelect) {
                keywordData.logic = logicSelect.value;
            }
            
            result.push(keywordData);
        }
    });
    
    return result;
}

function populateKeywordsContainer(container, keywordData) {
    clearKeywordsContainer(container);
    
    if (keywordData && keywordData.length > 0) {
        keywordData.forEach((data, index) => {
            const isLast = index === keywordData.length - 1;
            if (typeof data === 'string') {
                // 兼容旧格式
                addKeywordInput(container, data, 'or', isLast);
            } else {
                // 新格式
                addKeywordInput(container, data.keyword, data.logic || 'or', isLast);
            }
        });
    } else {
        addKeywordInput(container, '', 'or', true); // 至少一个空输入框
    }
    
    // 添加"添加关键字"按钮
    addKeywordGroup(container);
}

// 填充下拉框
function populateDropdowns() {
    // 清空现有选项
    folderSelect.innerHTML = '<option value="">请选择文件夹</option>';

    // 填充文件夹
    for (const name in availableFolders) {
        const option = document.createElement('option');
        option.value = name; // 使用名称作为值，ID在后台处理
        option.textContent = name;
        folderSelect.appendChild(option);
    }
    
    console.log('下拉框已填充:', { tags: Object.keys(availableTags), folders: Object.keys(availableFolders) });
}

// ===============================================
// 事件监听器
// ===============================================

document.getElementById('newRuleBtn').addEventListener('click', () => {
    clearForm();
    showModal(ruleModal);
});

closeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        hideModal(ruleModal);
        hideModal(detailModal);
    });
});

window.addEventListener('click', (event) => {
    if (event.target === ruleModal) {
        hideModal(ruleModal);
    }
    if (event.target === detailModal) {
        hideModal(detailModal);
    }
});

// 规则启用/禁用切换
subjectConditionToggle.addEventListener('change', (e) => {
    toggleConditionFields('subject', e.target.checked);
});

senderConditionToggle.addEventListener('change', (e) => {
    toggleConditionFields('sender', e.target.checked);
});

recipientConditionToggle.addEventListener('change', (e) => {
    toggleConditionFields('recipient', e.target.checked);
});

ccConditionToggle.addEventListener('change', (e) => {
    toggleConditionFields('cc', e.target.checked);
});

bodyConditionToggle.addEventListener('change', (e) => {
    toggleConditionFields('body', e.target.checked);
});

moveToFolderAction.addEventListener('change', (e) => {
    folderSelect.disabled = !e.target.checked;
    if (!e.target.checked) folderSelect.value = '';
});

setLabelAction.addEventListener('change', (e) => {
    tagSelect.classList.toggle('disabled', !e.target.checked);
    if (!e.target.checked) {
        clearTags();
    }
});

// 取消按钮事件监听
cancelButton.addEventListener('click', () => {
    hideModal(ruleModal);
});

// 规则类型切换处理
document.querySelectorAll('input[name="actionType"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const isNormalRule = e.target.value === 'normal';
        normalRuleActions.style.display = isNormalRule ? 'block' : 'none';
        
        // 如果切换到彻底删除，清空所有操作选项
        if (!isNormalRule) {
            moveToFolderAction.checked = false;
            setLabelAction.checked = false;
            markReadAction.checked = false;
            folderSelect.value = '';
            tagSelect.value = '';
            folderSelect.disabled = true;
            tagSelect.disabled = true;
        }
    });
});

// ===============================================
// 直接存储操作函数 - 替代 Background Script 消息传递
// ===============================================

/**
 * 直接保存规则到存储
 */
async function saveRuleToStorage(rule) {
    try {
        // 获取现有规则
        const result = await chrome.storage.local.get('aliMailRules');
        let rules = result.aliMailRules || [];
        
        // 查找是否已存在
        const index = rules.findIndex(r => r.id === rule.id);
        if (index !== -1) {
            rules[index] = rule; // 更新
        } else {
            rule.id = Date.now().toString(); // 生成新ID
            rules.push(rule); // 添加
        }
        
        // 保存回存储
        await chrome.storage.local.set({ aliMailRules: rules });
        console.log('[Options]: 规则已保存到存储:', rule);
        return { success: true };
    } catch (error) {
        console.error('[Options]: 保存规则失败:', error);
        return { success: false, error: error.message };
    }
}

/**
 * 直接从存储删除规则
 */
async function deleteRuleFromStorage(ruleId) {
    try {
        const result = await chrome.storage.local.get('aliMailRules');
        let rules = result.aliMailRules || [];
        
        rules = rules.filter(r => r.id !== ruleId);
        
        await chrome.storage.local.set({ aliMailRules: rules });
        console.log('[Options]: 规则已从存储删除:', ruleId);
        return { success: true };
    } catch (error) {
        console.error('[Options]: 删除规则失败:', error);
        return { success: false, error: error.message };
    }
}

/**
 * 直接切换规则状态
 */
async function toggleRuleStatusInStorage(ruleId) {
    try {
        const result = await chrome.storage.local.get('aliMailRules');
        let rules = result.aliMailRules || [];
        
        const rule = rules.find(r => r.id === ruleId);
        if (rule) {
            rule.enabled = !rule.enabled;
            await chrome.storage.local.set({ aliMailRules: rules });
            console.log('[Options]: 规则状态已切换:', ruleId, rule.enabled);
            return { success: true, enabled: rule.enabled };
        } else {
            return { success: false, error: '规则不存在' };
        }
    } catch (error) {
        console.error('[Options]: 切换规则状态失败:', error);
        return { success: false, error: error.message };
    }
}

// ===============================================
// 规则数据处理 (与 Background Script 通信)
// ===============================================

ruleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ruleId = ruleIdInput.value;
    const ruleName = ruleNameInput.value.trim();
    const ruleEnabled = ruleEnabledCheckbox.checked;

    if (!ruleName) {
        alert('规则名称不能为空！');
        return;
    }

    // 收集主题条件
    const subjectCondition = {};
    if (subjectConditionToggle.checked) {
        subjectCondition.enabled = true;
        subjectCondition.type = subjectConditionType.value;
        subjectCondition.keywords = getKeywordsFromContainer(subjectKeywordsContainer);
        subjectCondition.caseSensitive = subjectCaseSensitiveCheckbox.checked;

        if (subjectCondition.keywords.length === 0) {
            alert('请至少为主题条件输入一个关键字！');
            return;
        }
    } else {
        subjectCondition.enabled = false;
    }

    // 收集发件人条件
    const senderCondition = {};
    if (senderConditionToggle.checked) {
        senderCondition.enabled = true;
        senderCondition.type = senderConditionType.value;
        senderCondition.address = senderAddressInput.value;
        senderCondition.caseSensitive = senderCaseSensitiveCheckbox.checked;

        if (!senderCondition.address) {
            alert('请输入发件人地址！');
            return;
        }
    } else {
        senderCondition.enabled = false;
    }

    // 收集收件人条件
    const recipientCondition = {};
    if (recipientConditionToggle.checked) {
        recipientCondition.enabled = true;
        recipientCondition.type = recipientConditionType.value;
        recipientCondition.address = recipientAddressInput.value;
        recipientCondition.caseSensitive = recipientCaseSensitiveCheckbox.checked;

        if (!recipientCondition.address) {
            alert('请输入收件人地址！');
            return;
        }
    } else {
        recipientCondition.enabled = false;
    }

    // 收集抄送条件
    const ccCondition = {};
    if (ccConditionToggle.checked) {
        ccCondition.enabled = true;
        ccCondition.type = ccConditionType.value;
        ccCondition.address = ccAddressInput.value.trim();
        ccCondition.caseSensitive = ccCaseSensitiveCheckbox.checked;

        if (!ccCondition.address) {
            alert('请输入抄送地址！');
            return;
        }
    } else {
        ccCondition.enabled = false;
    }

    // 收集正文条件
    const bodyCondition = {};
    if (bodyConditionToggle.checked) {
        bodyCondition.enabled = true;
        bodyCondition.type = bodyConditionType.value;
        bodyCondition.keywords = getKeywordsFromContainer(bodyKeywordsContainer);
        bodyCondition.caseSensitive = bodyCaseSensitiveCheckbox.checked;

        if (bodyCondition.keywords.length === 0) {
            alert('请至少为正文条件输入一个关键字！');
            return;
        }
    } else {
        bodyCondition.enabled = false;
    }

    // 收集操作
    const action = {};
    action.type = document.querySelector('input[name="actionType"]:checked').value; // 'normal' 或 'delete'

    if (moveToFolderAction.checked) {
        action.moveToFolder = folderSelect.value;
        if (!action.moveToFolder) { alert('请选择要移动到的文件夹！'); return; }
    }
    if (setLabelAction.checked) {
        const selectedTagsList = getSelectedTags();
        if (selectedTagsList.length === 0) {
            alert('请至少选择一个标签！');
            return;
        }
        action.setLabel = selectedTagsList;
    }
    action.markAsRead = markReadAction.checked;
    action.stopProcessing = stopProcessingAction.checked;

    const rule = {
        id: ruleId || Date.now().toString(), // 新建时生成ID
        name: ruleName,
        enabled: ruleEnabled,
        conditions: {
            subject: subjectCondition,
            sender: senderCondition,
            recipient: recipientCondition,
            cc: ccCondition,
            body: bodyCondition,
        },
        action: action
    };

    // 直接保存规则到存储
    try {
        const response = await saveRuleToStorage(rule);
        if (response && response.success) {
            alert('规则保存成功！');
            hideModal(ruleModal);
            renderRules(); // 重新渲染列表
        } else {
            alert('规则保存失败: ' + (response?.error || '未知错误'));
        }
    } catch (error) {
        console.error('保存规则时出错:', error);
        alert('规则保存失败: ' + error.message);
    }
});

// 渲染规则列表
async function renderRules() {
    try {
        // 直接从存储读取规则
        const result = await chrome.storage.local.get('aliMailRules');
        const rules = result.aliMailRules || [];
        rulesListBody.innerHTML = '';
        
        if (!Array.isArray(rules)) {
            console.warn('获取到的规则不是数组:', rules);
            return;
        }
        
        rules.forEach(rule => {
            const row = rulesListBody.insertRow();
            row.dataset.ruleId = rule.id;

            // 勾选框
            const checkboxCell = row.insertCell();
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'rule-checkbox';
            checkbox.addEventListener('change', updateControlButtons);
            checkboxCell.appendChild(checkbox);

            // 名称
            const nameCell = row.insertCell();
            nameCell.textContent = rule.name;

            // 操作按钮
            const actionCell = row.insertCell();
            const detailBtn = document.createElement('button');
            detailBtn.textContent = '详情';
            detailBtn.addEventListener('click', () => showRuleDetail(rule));
            actionCell.appendChild(detailBtn);

            const editBtn = document.createElement('button');
            editBtn.textContent = '编辑';
            editBtn.addEventListener('click', () => editRule(rule));
            actionCell.appendChild(editBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = '删除';
            deleteBtn.addEventListener('click', async () => {
                if (confirm(`确定要删除规则 "${rule.name}" 吗？`)) {
                    try {
                        const response = await deleteRuleFromStorage(rule.id);
                        if (response && response.success) {
                            alert('规则删除成功！');
                            renderRules();
                        } else {
                            alert('规则删除失败: ' + (response?.error || '未知错误'));
                        }
                    } catch (error) {
                        console.error('删除规则时出错:', error);
                        alert('规则删除失败: ' + error.message);
                    }
                }
            });
            actionCell.appendChild(deleteBtn);

            // 状态滑块
            const statusCell = row.insertCell();
            const statusToggle = document.createElement('div');
            statusToggle.className = `rule-status-toggle ${rule.enabled ? 'enabled' : ''}`;
            statusToggle.addEventListener('click', async () => {
                try {
                    const response = await toggleRuleStatusInStorage(rule.id);
                    if (response && response.success) {
                        rule.enabled = response.enabled; // 更新本地状态
                        statusToggle.classList.toggle('enabled', response.enabled);
                    } else {
                        alert('切换规则状态失败: ' + (response?.error || '未知错误'));
                    }
                } catch (error) {
                    console.error('切换规则状态时出错:', error);
                    alert('切换规则状态失败: ' + error.message);
                }
            });
            statusCell.appendChild(statusToggle);
        });
        updateControlButtons();
    } catch (error) {
        console.error('渲染规则列表时出错:', error);
    }
}

// 更新顶部的手动执行和删除按钮状态
function updateControlButtons() {
    const checkedRules = document.querySelectorAll('.rule-checkbox:checked');
    document.getElementById('deleteSelectedBtn').disabled = checkedRules.length === 0;
    document.getElementById('manualExecuteBtn').disabled = checkedRules.length === 0;
}

// 全选/全不选
document.getElementById('selectAllRules').addEventListener('change', (e) => {
    document.querySelectorAll('.rule-checkbox').forEach(checkbox => {
        checkbox.checked = e.target.checked;
    });
    updateControlButtons();
});

// 手动执行规则
document.getElementById('manualExecuteBtn').addEventListener('click', async () => {
    const btn = document.getElementById('manualExecuteBtn');
    const checkedRuleCheckboxes = document.querySelectorAll('#rulesList tbody .rule-checkbox:checked');
    
    if (checkedRuleCheckboxes.length === 0) {
        alert('请至少选择一个规则来执行。');
        // The button should be disabled by updateControlButtons, but as a safeguard:
        if (!btn.disabled) { // If somehow it was enabled without checks
             updateControlButtons(); // Re-evaluate button states
        }
        return;
    }

    const selectedRuleIds = Array.from(checkedRuleCheckboxes).map(cb => {
        return cb.closest('tr').dataset.ruleId;
    });

    btn.disabled = true;
    btn.textContent = '执行中...';
    
    try {
        // 查找阿里邮箱页面
        const tabs = await chrome.tabs.query({url: "https://qiye.aliyun.com/alimail/*"});
        
        if (tabs.length === 0) {
            alert('请先打开阿里邮箱页面');
            btn.disabled = false;
            btn.textContent = '手动执行规则';
            return;
        }

        // 向 Background Script 发送手动执行规则的请求
        console.log(`[Options]: Sending manualExecuteRules for rule IDs: ${selectedRuleIds.join(', ')}`);
        const response = await chrome.runtime.sendMessage({
            action: "manualExecuteRules",
            tabId: tabs[0].id,
            selectedRuleIds: selectedRuleIds // Send the selected rule IDs
        });

        console.log('[Options]: Raw response from background:', response); // Log the raw response

        if (response && response.success) {
            let message = `规则执行完成！\n处理了 ${response.processedMailCount || 0} 封邮件 (共 ${response.totalMailCountInScope || 0} 封相关邮件)。`;
            if (response.actionsTakenCounts) {
                message += `\n\n操作统计:\n  - 标记已读: ${response.actionsTakenCounts.markedRead || 0} 封\n  - 应用标签: ${response.actionsTakenCounts.labeled || 0} 封\n  - 移动邮件: ${response.actionsTakenCounts.moved || 0} 封`;
            }
            if (response.message && response.processedMailCount === 0) { // Display message from background if any (e.g., no mails, or no rules matched)
                message = response.message;
            }
            alert(message);
        } else {
            // Log the error more verbosely if it's an object
            let errorDetails = response?.error || '未知错误';
            if (typeof response?.error === 'object') {
                errorDetails = JSON.stringify(response.error);
            }
            alert('规则执行失败: ' + errorDetails);
            console.error('[Options]: 规则执行失败, response:', response);
        }
    } catch (error) {
        console.error('[Options]: 手动执行规则时出错 (catch block):', error);
        alert('规则执行失败: ' + error.message);
    } finally {
        // Re-enable based on current selection, not just blindly
        updateControlButtons(); 
        if (!btn.disabled) { // If updateControlButtons re-enabled it
            btn.textContent = '手动执行规则';
        }
    }
});

// 编辑规则
function editRule(rule) {
    clearForm();
    modalTitle.textContent = '编辑收信规则';
    ruleIdInput.value = rule.id;
    ruleNameInput.value = rule.name;
    ruleEnabledCheckbox.checked = rule.enabled;

    // 填充主题条件
    if (rule.conditions && rule.conditions.subject && rule.conditions.subject.enabled) {
        subjectConditionToggle.checked = true;
        toggleConditionFields('subject', true);
        subjectConditionType.value = rule.conditions.subject.type || 'include';
        subjectCaseSensitiveCheckbox.checked = rule.conditions.subject.caseSensitive || false;
        populateKeywordsContainer(subjectKeywordsContainer, rule.conditions.subject.keywords);
    } else {
        subjectConditionToggle.checked = false;
        toggleConditionFields('subject', false);
        populateKeywordsContainer(subjectKeywordsContainer, []); // 默认添加一个空输入框
    }

    // 填充发件人条件
    if (rule.conditions && rule.conditions.sender && rule.conditions.sender.enabled) {
        senderConditionToggle.checked = true;
        toggleConditionFields('sender', true);
        senderConditionType.value = rule.conditions.sender.type || 'include';
        senderAddressInput.value = rule.conditions.sender.address || '';
        senderCaseSensitiveCheckbox.checked = rule.conditions.sender.caseSensitive || false;
    } else {
        senderConditionToggle.checked = false;
        toggleConditionFields('sender', false);
        senderAddressInput.value = '';
    }

    // 填充收件人条件
    if (rule.conditions && rule.conditions.recipient && rule.conditions.recipient.enabled) {
        recipientConditionToggle.checked = true;
        toggleConditionFields('recipient', true);
        recipientConditionType.value = rule.conditions.recipient.type || 'include';
        recipientAddressInput.value = rule.conditions.recipient.address || '';
        recipientCaseSensitiveCheckbox.checked = rule.conditions.recipient.caseSensitive || false;
    } else {
        recipientConditionToggle.checked = false;
        toggleConditionFields('recipient', false);
        recipientAddressInput.value = '';
    }

    // 填充抄送条件
    if (rule.conditions && rule.conditions.cc && rule.conditions.cc.enabled) {
        ccConditionToggle.checked = true;
        toggleConditionFields('cc', true);
        ccConditionType.value = rule.conditions.cc.type || 'include';
        ccAddressInput.value = rule.conditions.cc.address || '';
        ccCaseSensitiveCheckbox.checked = rule.conditions.cc.caseSensitive || false;
    } else {
        ccConditionToggle.checked = false;
        toggleConditionFields('cc', false);
        ccAddressInput.value = '';
    }

    // 填充正文条件
    if (rule.conditions && rule.conditions.body && rule.conditions.body.enabled) {
        bodyConditionToggle.checked = true;
        toggleConditionFields('body', true);
        bodyConditionType.value = rule.conditions.body.type || 'include';
        bodyCaseSensitiveCheckbox.checked = rule.conditions.body.caseSensitive || false;
        populateKeywordsContainer(bodyKeywordsContainer, rule.conditions.body.keywords);
    } else {
        bodyConditionToggle.checked = false;
        toggleConditionFields('body', false);
        populateKeywordsContainer(bodyKeywordsContainer, []); // 默认添加一个空输入框
    }

    // 填充操作
    if (rule.action && rule.action.moveToFolder) {
        moveToFolderAction.checked = true;
        folderSelect.disabled = false;
        folderSelect.value = rule.action.moveToFolder;
    }
    if (rule.action && rule.action.setLabel) {
        setLabelAction.checked = true;
        tagSelect.classList.remove('disabled');
        const tags = Array.isArray(rule.action.setLabel) ? rule.action.setLabel : [rule.action.setLabel];
        tags.forEach(tag => addTag(tag));
    }
    if (rule.action) {
        markReadAction.checked = rule.action.markAsRead || false;
    }
    stopProcessingAction.checked = (rule.action && typeof rule.action.stopProcessing !== 'undefined') ? rule.action.stopProcessing : true; // 默认勾选

    showModal(ruleModal);
}

// 显示规则详情
function showRuleDetail(rule) {
    document.getElementById('detailModalTitle').textContent = `规则详情: ${rule.name}`;
    const detailConditions = document.getElementById('detailConditions');
    const detailActions = document.getElementById('detailActions');
    
    detailConditions.innerHTML = '';
    detailActions.innerHTML = '';

    // 条件详情
    if (rule.conditions && rule.conditions.subject && rule.conditions.subject.enabled) {
        const keywords = rule.conditions.subject.keywords || [];
        let keywordDisplay = '';
        
        if (Array.isArray(keywords) && keywords.length > 0) {
            if (typeof keywords[0] === 'string') {
                // 兼容旧格式
                keywordDisplay = keywords.join(', ');
            } else {
                // 新格式：显示关键字和逻辑连接符
                keywordDisplay = keywords.map((item, index) => {
                    let result = `"${item.keyword}"`;
                    if (index < keywords.length - 1 && item.logic) {
                        result += ` ${item.logic === 'or' ? '或' : '且'} `;
                    }
                    return result;
                }).join('');
            }
        }
        
        detailConditions.innerHTML += `<p><strong>主题:</strong> ${rule.conditions.subject.type === 'include' ? '包含' : '不包含'}关键字 ${keywordDisplay}${rule.conditions.subject.caseSensitive ? ' (区分大小写)' : ''}</p>`;
    }

    if (rule.conditions && rule.conditions.sender && rule.conditions.sender.enabled) {
        detailConditions.innerHTML += `<p><strong>发件人:</strong> ${rule.conditions.sender.type === 'include' ? '包含' : '不包含'}地址 ${rule.conditions.sender.address}${rule.conditions.sender.caseSensitive ? ' (区分大小写)' : ''}</p>`;
    }

    if (rule.conditions && rule.conditions.recipient && rule.conditions.recipient.enabled) {
        detailConditions.innerHTML += `<p><strong>收件人:</strong> ${rule.conditions.recipient.type === 'include' ? '包含' : '不包含'}地址 ${rule.conditions.recipient.address}${rule.conditions.recipient.caseSensitive ? ' (区分大小写)' : ''}</p>`;
    }

    if (rule.conditions && rule.conditions.cc && rule.conditions.cc.enabled) {
        detailConditions.innerHTML += `<p><strong>抄送:</strong> ${rule.conditions.cc.type === 'include' ? '包含' : '不包含'}地址 ${rule.conditions.cc.address}${rule.conditions.cc.caseSensitive ? ' (区分大小写)' : ''}</p>`;
    }

    if (rule.conditions && rule.conditions.body && rule.conditions.body.enabled) {
        const keywords = rule.conditions.body.keywords || [];
        let keywordDisplay = '';
        
        if (Array.isArray(keywords) && keywords.length > 0) {
            if (typeof keywords[0] === 'string') {
                // 兼容旧格式
                keywordDisplay = keywords.join(', ');
            } else {
                // 新格式：显示关键字和逻辑连接符
                keywordDisplay = keywords.map((item, index) => {
                    let result = `"${item.keyword}"`;
                    if (index < keywords.length - 1 && item.logic) {
                        result += ` ${item.logic === 'or' ? '或' : '且'} `;
                    }
                    return result;
                }).join('');
            }
        }
        
        detailConditions.innerHTML += `<p><strong>正文内容:</strong> ${rule.conditions.body.type === 'include' ? '包含' : '不包含'}关键字 ${keywordDisplay}${rule.conditions.body.caseSensitive ? ' (区分大小写)' : ''}</p>`;
    }

    // 操作详情
    if (rule.action) {
        if (rule.action.moveToFolder) {
            detailActions.innerHTML += `<p><strong>移动到文件夹:</strong> "${rule.action.moveToFolder}"</p>`;
        }
        if (rule.action.setLabel) {
            detailActions.innerHTML += `<p><strong>设置标签:</strong> "${rule.action.setLabel}"</p>`;
        }
        if (rule.action.markAsRead) {
            detailActions.innerHTML += '<p><strong>标记为已读:</strong> 是</p>';
        }
        if (typeof rule.action.stopProcessing !== 'undefined') {
            detailActions.innerHTML += `<p><strong>停止处理其他规则:</strong> ${rule.action.stopProcessing ? '是' : '否'}</p>`;
        }
    }
    
    if (detailActions.innerHTML === '') {
        detailActions.innerHTML = '<p>无执行操作</p>';
    }

    showModal(detailModal);
}

// 标签选择处理
function initializeTagSelect() {
    // 监听标签启用/禁用状态
    setLabelAction.addEventListener('change', (e) => {
        tagSelect.classList.toggle('disabled', !e.target.checked);
        if (!e.target.checked) {
            clearTags();
        }
    });

    // 点击选择框时显示/隐藏下拉列表
    tagSelect.addEventListener('click', (e) => {
        if (tagSelect.classList.contains('disabled')) return;
        
        const wasVisible = tagDropdown.classList.contains('show');
        tagSelect.classList.toggle('focused', !wasVisible);
        tagDropdown.classList.toggle('show', !wasVisible);
        
        if (!wasVisible) {
            updateTagDropdown();
        }
    });

    // 点击外部时关闭下拉列表
    document.addEventListener('click', (e) => {
        if (!tagSelect.contains(e.target) && !tagDropdown.contains(e.target)) {
            tagDropdown.classList.remove('show');
            tagSelect.classList.remove('focused');
        }
    });
}

function updateTagDropdown() {
    if (Object.keys(availableTags).length === 0) {
        tagDropdown.innerHTML = '<div class="multi-select-item">暂无可用标签</div>';
        return;
    }

    tagDropdown.innerHTML = Object.keys(availableTags).map(tag => `
        <div class="multi-select-item ${selectedTags.has(tag) ? 'selected' : ''}" data-tag="${tag}">
            <input type="checkbox" ${selectedTags.has(tag) ? 'checked' : ''}>
            <span>${tag}</span>
        </div>
    `).join('');

    // 添加点击事件
    tagDropdown.querySelectorAll('.multi-select-item').forEach(item => {
        item.addEventListener('click', () => {
            const tagName = item.dataset.tag;
            if (selectedTags.has(tagName)) {
                removeTag(tagName);
            } else {
                addTag(tagName);
            }
            updateTagDropdown();
        });
    });
}

function addTag(tagName) {
    if (selectedTags.has(tagName)) return;

    const tagElement = document.createElement('div');
    tagElement.className = 'selected-tag';
    tagElement.innerHTML = `
        <span>${tagName}</span>
        <span class="remove-tag">×</span>
    `;

    tagElement.querySelector('.remove-tag').addEventListener('click', (e) => {
        e.stopPropagation(); // 防止触发选择框的点击事件
        removeTag(tagName);
        updateTagDropdown();
    });

    selectedTags.add(tagName);
    
    // 移除placeholder
    const placeholder = tagSelect.querySelector('.placeholder');
    if (placeholder) {
        placeholder.remove();
    }
    
    tagSelect.insertBefore(tagElement, tagSelect.lastChild);
}

function removeTag(tagName) {
    selectedTags.delete(tagName);
    const tagElement = Array.from(tagSelect.querySelectorAll('.selected-tag'))
        .find(el => el.querySelector('span').textContent === tagName);
    if (tagElement) {
        tagElement.remove();
    }
    
    // 如果没有选中的标签，显示placeholder
    if (selectedTags.size === 0) {
        const placeholder = document.createElement('span');
        placeholder.className = 'placeholder';
        placeholder.textContent = '请选择标签';
        tagSelect.appendChild(placeholder);
    }
}

function clearTags() {
    selectedTags.clear();
    tagSelect.innerHTML = '<span class="placeholder">请选择标签</span>';
    if (tagDropdown.classList.contains('show')) {
        updateTagDropdown();
    }
}

function getSelectedTags() {
    return Array.from(selectedTags);
}

// 初始化标签选择
initializeTagSelect();

// 初始化：加载规则并填充下拉框
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Options页面初始化开始...');
    
    try {
        // 直接从存储读取标签和文件夹数据，不通过 Background Script
        const storageResult = await chrome.storage.local.get(['aliMailTags', 'aliMailFolders', 'aliMailRules']);
        
        console.log('从存储直接读取的数据:', storageResult);
        
        // 获取标签和文件夹数据
        availableTags = storageResult.aliMailTags || {};
        availableFolders = storageResult.aliMailFolders || {};
        
        console.log('成功获取数据:', { tags: availableTags, folders: availableFolders });
        
        if (Object.keys(availableTags).length === 0 && Object.keys(availableFolders).length === 0) {
            console.warn("提示：请确保阿里邮箱页面已打开并登录，然后刷新此页面。");
        }
        
        populateDropdowns();

        // 直接从存储读取规则数据
        const rules = storageResult.aliMailRules || [];
        console.log('从存储读取的规则:', rules);
        
        // 渲染规则列表
        await renderRules();
        console.log('Options页面初始化完成');
    } catch (error) {
        console.error('Options页面初始化时出错:', error);
    }
});
