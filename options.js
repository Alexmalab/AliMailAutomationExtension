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

// Main Condition Toggles & Containers
const conditionTypes = ['subject', 'sender', 'recipient', 'cc', 'body'];
const conditionElements = {};

conditionTypes.forEach(type => {
    conditionElements[type] = {
        toggle: document.getElementById(`${type}ConditionToggle`),
        container: document.getElementById(`${type}ConditionsContainer`), // e.g., subjectConditionsContainer
        addBtn: document.getElementById(`add${type.charAt(0).toUpperCase() + type.slice(1)}GroupBtn`), // e.g., addSubjectGroupBtn
        // Old individual fields - keep for now for clearForm, but will be removed/refactored for group structure
        typeSelect: document.getElementById(`${type}ConditionType`), // e.g., subjectConditionType
        keywordsContainer: type === 'subject' || type === 'body' ? document.getElementById(`${type}KeywordsContainer`) : null, // e.g., subjectKeywordsContainer
        caseSensitiveCheckbox: document.getElementById(`${type}CaseSensitive`), // e.g., subjectCaseSensitive
        addressInput: type === 'sender' || type === 'recipient' || type === 'cc' ? document.getElementById(`${type}Address`) : null // e.g., senderAddress
    };
});

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

// AI Condition Elements
const systemPromptDisplay = document.getElementById('systemPromptDisplay');
const userAiPromptInput = document.getElementById('userAiPrompt');
const normalConditionsContainer = document.getElementById('normalConditionsContainer');
const aiConditionsContainer = document.getElementById('aiConditionsContainer');
const conditionModeRadios = document.querySelectorAll('input[name="conditionMode"]');

const DEFAULT_SYSTEM_PROMPT = `You are an email classification assistant. Based on the user\'s query and the provided email content (subject and body), determine if the email matches the user\'s criteria.\nRespond with only \'MATCH\' if it matches, or \'NO_MATCH\' if it does not. Do not provide any explanation or any other text.`;

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

    conditionTypes.forEach(type => {
        const elements = conditionElements[type];
        if (elements.toggle) {
            elements.toggle.checked = false;
        }

        if (elements.container) {
            elements.container.innerHTML = '';
        }

        if (elements.addBtn) {
            elements.addBtn.disabled = true;
            elements.addBtn.style.display = 'none'; // Explicitly hide
        }

        // Legacy fields cleanup
        if (elements.typeSelect) elements.typeSelect.disabled = true;
        if (elements.caseSensitiveCheckbox) elements.caseSensitiveCheckbox.disabled = true;
        if (elements.keywordsContainer) { // old subjectKeywordsContainer / bodyKeywordsContainer
            clearKeywordsContainer(elements.keywordsContainer); // Clear old single container
            elements.keywordsContainer.style.display = 'none'; // Hide old container
        }
        if (elements.addressInput) { // old senderAddressInput etc.
            elements.addressInput.disabled = true;
            elements.addressInput.value = '';
            elements.addressInput.style.display = 'none'; // Hide old container
        }
        // Hide legacy wrapper divs if they exist and are separate
        const legacyWrapper = document.getElementById(`${type}ConditionFields`); // e.g. subjectConditionFields
        if (legacyWrapper) {
            legacyWrapper.style.display = 'none';
        }
    });

    // Ensure old global keyword containers (if not already caught above) are cleared and hidden
    // These might be different from the ones in conditionElements if HTML structure was mixed
    if (document.getElementById('subjectKeywordsContainer')) {
         clearKeywordsContainer(document.getElementById('subjectKeywordsContainer'));
         document.getElementById('subjectKeywordsContainer').style.display = 'none';
    }
    if (document.getElementById('bodyKeywordsContainer')) {
        clearKeywordsContainer(document.getElementById('bodyKeywordsContainer'));
        document.getElementById('bodyKeywordsContainer').style.display = 'none';
    }
    // Hide old address input fields that were global
    ['senderAddress', 'recipientAddress', 'ccAddress'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.value = '';
            el.disabled = true;
            el.style.display = 'none';
        }
    });


    // Reset operations
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

    // Reset AI conditions
    document.querySelector('input[name="conditionMode"][value="normal"]').checked = true;
    normalConditionsContainer.style.display = 'block';
    aiConditionsContainer.style.display = 'none';
    systemPromptDisplay.value = DEFAULT_SYSTEM_PROMPT;
    userAiPromptInput.value = '';
}

function toggleConditionFields(conditionType, enabled) {
    if (conditionType === 'subject') {
function toggleConditionFields(conditionType, enabled) {
    // This function is now primarily for the main toggle controlling the "Add Group" button
    // and the overall state of existing groups for that type.
    const elements = conditionElements[conditionType];
    if (!elements) {
        console.error(`toggleConditionFields: Elements for type ${conditionType} not found.`);
        return;
    }

    if (elements.addBtn) {
        elements.addBtn.disabled = !enabled;
        elements.addBtn.style.display = enabled ? 'inline-block' : 'none'; // Manage visibility
    }

    // Disable/Enable all controls within each group of this type
    if (elements.container) {
        const groups = elements.container.querySelectorAll(`.condition-group.${conditionType}-group`);
        groups.forEach(groupDiv => {
            const groupEnabledCheckbox = groupDiv.querySelector('.condition-group-enabled');
            // If overall section is disabled, the group's own checkbox is disabled.
            // If overall section is enabled, group's checkbox state determines its controls.
            groupEnabledCheckbox.disabled = !enabled;

            const isEffectivelyEnabled = enabled && groupEnabledCheckbox.checked;

            groupDiv.querySelectorAll('.condition-group-type, .condition-group-case-sensitive, .condition-group-address').forEach(el => {
                el.disabled = !isEffectivelyEnabled;
            });

            if (conditionType === 'subject' || conditionType === 'body') {
                const keywordsContainer = groupDiv.querySelector('.keywords-container-for-this-group');
                if (keywordsContainer) {
                    keywordsContainer.querySelectorAll('input, button, select').forEach(el => {
                        el.disabled = !isEffectivelyEnabled;
                    });
                    // If re-enabling the section, and group is checked, ensure keyword buttons are correct
                    if (isEffectivelyEnabled) {
                         const kwData = getKeywordsFromContainer(keywordsContainer);
                         populateKeywordsContainer(keywordsContainer, kwData, true); // true because isEffectivelyEnabled
                    }
                }
            }
            // The remove button for the group should reflect the overall toggle state
            const removeGroupBtn = groupDiv.querySelector('.remove-condition-group-btn');
            if (removeGroupBtn) {
                removeGroupBtn.disabled = !enabled;
            }
        });
    }

    // Hide/show legacy single field wrappers if they exist
    // These should eventually be removed from HTML.
    const legacyWrapperId = `${conditionType}ConditionFields`; // e.g., subjectConditionFields
    const legacyWrapper = document.getElementById(legacyWrapperId);
    if (legacyWrapper) {
        legacyWrapper.style.display = 'none'; // Always hide, new group UI supersedes
    }
     // Also hide old individual keyword containers and address inputs
    if (elements.keywordsContainer) elements.keywordsContainer.style.display = 'none';
    if (elements.addressInput) elements.addressInput.style.display = 'none';


}

function clearKeywordsContainer(container) {
    container.innerHTML = '';
}

function addKeywordInput(container, value = '', logic = 'or', isLast = true, groupEnabled = true) {
    const hasEmptyKeyword = Array.from(container.querySelectorAll('.keyword-item input[type="text"]'))
        .some(input => !input.value.trim());
    
    if (hasEmptyKeyword && !value) {
        return;
    }

    const div = document.createElement('div');
    div.className = 'keyword-item';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '关键字';
    input.value = value;
    input.disabled = !groupEnabled;

    let logicSelectElement = null;
    if (!isLast) {
        logicSelectElement = document.createElement('select');
        logicSelectElement.disabled = !groupEnabled;
        logicSelectElement.innerHTML = '<option value="or">或</option><option value="and">且</option>';
        logicSelectElement.value = logic;
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.title = '删除关键字';
    removeBtn.disabled = !groupEnabled;
    removeBtn.addEventListener('click', () => {
        if (container.querySelectorAll('.keyword-item').length <= 1) {
            return;
        }
        div.remove();
        updateLastKeywordItem(container, groupEnabled);
    });

    div.appendChild(input);
    if (logicSelectElement) {
        div.appendChild(logicSelectElement);
    }
    div.appendChild(removeBtn);
    container.appendChild(div);
}

function updateLastKeywordItem(container, groupEnabled = true) {
    const items = container.querySelectorAll('.keyword-item');
    items.forEach((item, index) => {
        const logicSelect = item.querySelector('select');
        const isLastItem = index === items.length - 1;
        
        if (isLastItem && logicSelect) {
            logicSelect.remove();
        } else if (!isLastItem && !logicSelect) {
            const removeBtn = item.querySelector('button');
            const newLogicSelect = document.createElement('select');
            newLogicSelect.disabled = !groupEnabled;
            newLogicSelect.innerHTML = '<option value="or">或</option><option value="and">且</option>';
            newLogicSelect.value = 'or'; // Default to 'or'
            item.insertBefore(newLogicSelect, removeBtn);
        }
    });
}

function addKeywordGroupButton(container, groupEnabled = true) { // Renamed from addKeywordGroup
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'add-keyword-btn';
    addBtn.textContent = '+';
    addBtn.title = '添加关键字';
    addBtn.disabled = !groupEnabled;
    addBtn.addEventListener('click', () => {
        // Temporarily remove the button to re-add it after new input
        addBtn.remove();
        // Add new keyword input, not as the last one initially
        addKeywordInput(container, '', 'or', false, groupEnabled);
        // Update logic selectors for all items
        updateLastKeywordItem(container, groupEnabled);
        // Re-add the "Add Keyword" button
        addKeywordGroupButton(container, groupEnabled);
    });
    container.appendChild(addBtn);
}

// getConditionToggleState is no longer needed in its current form.
// Group enabled state will be passed directly or checked from the group's own checkbox.

function getKeywordsFromContainer(keywordsContainer) { // Parameter renamed for clarity
    const items = keywordsContainer.querySelectorAll('.keyword-item');
    const result = [];
    
    items.forEach((item, index) => {
        const input = item.querySelector('input[type="text"]');
        const logicSelect = item.querySelector('select');
        const keyword = input.value.trim();
        
        if (keyword !== '') {
            const keywordData = { keyword: keyword };
            if (index < items.length - 1 && logicSelect) { // Logic only if not last
                keywordData.logic = logicSelect.value;
            } else if (index < items.length - 1 && !logicSelect) { // Default to 'or' if no select but not last
                 keywordData.logic = 'or';
            }
            // For the last item, no logic property is added.
            result.push(keywordData);
        }
    });
    
    return result;
}

function populateKeywordsContainer(keywordsContainer, keywordDataArray, groupEnabled = true) { // Parameter renamed and groupEnabled added
    clearKeywordsContainer(keywordsContainer);
    
    if (keywordDataArray && keywordDataArray.length > 0) {
        keywordDataArray.forEach((data, index) => {
            const isLast = index === keywordDataArray.length - 1;
            if (typeof data === 'string') { // Compatibility with old string format
                addKeywordInput(keywordsContainer, data, 'or', isLast, groupEnabled);
            } else { // New object format
                addKeywordInput(keywordsContainer, data.keyword, data.logic || 'or', isLast, groupEnabled);
            }
        });
    } else {
        addKeywordInput(keywordsContainer, '', 'or', true, groupEnabled); // Add one empty input if no data
    }
    updateLastKeywordItem(keywordsContainer, groupEnabled); // Ensure logic selectors are correct
    addKeywordGroupButton(keywordsContainer, groupEnabled); // Add the "+" button
}

// ===============================================
// NEW: Condition Group UI Management
// ===============================================

/**
 * Creates a DOM element for a new condition group.
 * @param {string} conditionType - 'subject', 'body', 'sender', 'recipient', 'cc'.
 * @param {object} [groupData=null] - Optional data to populate the group.
 * @param {boolean} [isOverallEnabled=true] - Whether the parent condition type is enabled (e.g. subjectConditionToggle.checked)
 * @returns {HTMLElement} The condition group element.
 */
function createConditionGroupUI(conditionType, groupData = null, isOverallEnabled = true) {
    const groupDiv = document.createElement('div');
    groupDiv.className = `condition-group ${conditionType}-group mb-2 p-2 border rounded`;

    let isGroupEnabled = groupData ? groupData.enabled : true; // Default new groups to enabled

    const groupEnabledCheckbox = document.createElement('input');
    groupEnabledCheckbox.type = 'checkbox';
    groupEnabledCheckbox.className = 'condition-group-enabled form-check-input me-2';
    groupEnabledCheckbox.checked = isGroupEnabled && isOverallEnabled; // Group enabled only if overall toggle is also on
    groupEnabledCheckbox.disabled = !isOverallEnabled;
    groupEnabledCheckbox.title = 'Enable this specific condition group';

    const groupTypeSelect = document.createElement('select');
    groupTypeSelect.className = 'condition-group-type form-select form-select-sm me-2';
    groupTypeSelect.innerHTML = `
        <option value="include">Include</option>
        <option value="exclude">Exclude</option>
    `;
    groupTypeSelect.value = groupData ? groupData.type : 'include';
    groupTypeSelect.disabled = !isGroupEnabled || !isOverallEnabled;

    const groupCaseSensitiveCheckbox = document.createElement('input');
    groupCaseSensitiveCheckbox.type = 'checkbox';
    groupCaseSensitiveCheckbox.className = 'condition-group-case-sensitive form-check-input ms-2 me-1';
    groupCaseSensitiveCheckbox.checked = groupData ? groupData.caseSensitive : false;
    groupCaseSensitiveCheckbox.disabled = !isGroupEnabled || !isOverallEnabled;
    const caseSensitiveLabel = document.createElement('label');
    caseSensitiveLabel.className = 'form-check-label me-2';
    caseSensitiveLabel.textContent = 'Case Sensitive';
    caseSensitiveLabel.appendChild(groupCaseSensitiveCheckbox);


    const removeGroupBtn = document.createElement('button');
    removeGroupBtn.type = 'button';
    removeGroupBtn.className = 'remove-condition-group-btn btn btn-sm btn-outline-danger';
    removeGroupBtn.textContent = 'Remove Group';
    removeGroupBtn.disabled = !isOverallEnabled;
    removeGroupBtn.addEventListener('click', () => groupDiv.remove());

    // Top row for controls
    const controlsRow = document.createElement('div');
    controlsRow.className = 'd-flex align-items-center mb-2';
    controlsRow.appendChild(groupEnabledCheckbox);
    controlsRow.appendChild(document.createTextNode("Group Enabled")); // Simple label
    controlsRow.appendChild(groupTypeSelect);


    if (conditionType === 'subject' || conditionType === 'body') {
        const keywordsContainer = document.createElement('div');
        keywordsContainer.className = 'keywords-container-for-this-group mt-2';
        populateKeywordsContainer(keywordsContainer, groupData ? groupData.keywords : [], isGroupEnabled && isOverallEnabled);

        controlsRow.appendChild(caseSensitiveLabel); // Add case sensitive checkbox to controls row
        groupDiv.appendChild(controlsRow);
        groupDiv.appendChild(keywordsContainer);
    } else { // sender, recipient, cc
        const addressInput = document.createElement('input');
        addressInput.type = 'text';
        addressInput.className = 'condition-group-address form-control form-control-sm me-2';
        addressInput.placeholder = (conditionType === 'sender' ? 'Sender' : (conditionType === 'recipient' ? 'Recipient' : 'CC')) + ' Address';
        addressInput.value = groupData ? groupData.address : '';
        addressInput.disabled = !isGroupEnabled || !isOverallEnabled;

        controlsRow.appendChild(addressInput);
        controlsRow.appendChild(caseSensitiveLabel); // Add case sensitive checkbox to controls row
        groupDiv.appendChild(controlsRow);
    }
    
    groupDiv.appendChild(removeGroupBtn); // Add remove button at the bottom of the group

    // Event listener for the group's own enabled checkbox
    groupEnabledCheckbox.addEventListener('change', () => {
        const currentlyEnabled = groupEnabledCheckbox.checked;
        groupTypeSelect.disabled = !currentlyEnabled;
        groupCaseSensitiveCheckbox.disabled = !currentlyEnabled;

        if (conditionType === 'subject' || conditionType === 'body') {
            const keywordsContainer = groupDiv.querySelector('.keywords-container-for-this-group');
            keywordsContainer.querySelectorAll('input, button, select').forEach(el => el.disabled = !currentlyEnabled);
            // Repopulate to fix button states if needed, or just update disabled state of buttons
            const kwData = getKeywordsFromContainer(keywordsContainer);
            populateKeywordsContainer(keywordsContainer, kwData, currentlyEnabled);

        } else {
            const addressInput = groupDiv.querySelector('.condition-group-address');
            addressInput.disabled = !currentlyEnabled;
        }
    });
    return groupDiv;
}


/**
 * Sets up the "Add [Type] Condition Group" button for a given condition type.
 * @param {string} conditionType - 'subject', 'body', 'sender', 'recipient', 'cc'.
 */
function addConditionGroupEventListener(conditionType) {
    const mainContainer = document.getElementById(`${conditionType}ConditionsContainer`);
    const addBtn = document.getElementById(`add${conditionType.charAt(0).toUpperCase() + conditionType.slice(1)}GroupBtn`); // e.g. addSubjectGroupBtn

    if (!mainContainer || !addBtn) {
        console.error(`Missing container or button for ${conditionType}`);
        return;
    }

    addBtn.addEventListener('click', () => {
        // isOverallEnabled should be true if the add button is clickable.
        // This relies on the main toggle (e.g., subjectConditionToggle) enabling/disabling this add button.
        const newGroupUI = createConditionGroupUI(conditionType, null, true);
        mainContainer.appendChild(newGroupUI);
    });
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

// Set up main condition toggle listeners
conditionTypes.forEach(type => {
    const elements = conditionElements[type];
    if (elements.toggle) {
        elements.toggle.addEventListener('change', (e) => {
            toggleConditionFields(type, e.target.checked);
            if (e.target.checked && elements.container.children.length === 0) {
                // Optionally add a default empty group when main toggle is first enabled
                // For now, user must click "+ Add Group"
                // const newGroup = createConditionGroupUI(type, null, true);
                // elements.container.appendChild(newGroup);
            }
        });
    }
});

// Initialize "Add Group" button listeners
conditionTypes.forEach(type => {
    addConditionGroupEventListener(type);
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
    const conditionMode = document.querySelector('input[name="conditionMode"]:checked').value;

    if (!ruleName) {
        alert('规则名称不能为空！');
        return;
    }

    let conditions = {
        subject: [],
        sender: [],
        recipient: [],
        cc: [],
        body: []
    };
    let aiPromptDetails = null;

    if (conditionMode === 'normal') {
        let validationPassed = true;
        conditionTypes.forEach(type => {
            const elements = conditionElements[type];
            if (!elements.toggle.checked) {
                conditions[type] = []; // Main toggle for this condition type is off
                return; // Skip to next condition type
            }

            const groupsInContainer = elements.container.querySelectorAll(`.condition-group.${type}-group`);
            const collectedGroupsData = [];

            groupsInContainer.forEach(groupDiv => {
                const groupEnabledCheckbox = groupDiv.querySelector('.condition-group-enabled');
                const isGroupEnabled = groupEnabledCheckbox.checked;

                const groupTypeSelect = groupDiv.querySelector('.condition-group-type');
                const groupCaseSensitiveCheckbox = groupDiv.querySelector('.condition-group-case-sensitive');

                let groupSpecificData = {
                    enabled: isGroupEnabled,
                    type: groupTypeSelect.value,
                    caseSensitive: groupCaseSensitiveCheckbox.checked,
                };

                if (type === 'subject' || type === 'body') {
                    const keywordsContainer = groupDiv.querySelector('.keywords-container-for-this-group');
                    groupSpecificData.keywords = getKeywordsFromContainer(keywordsContainer);
                    if (isGroupEnabled && groupSpecificData.keywords.length === 0) {
                        alert(`Enabled '${type}' condition group cannot have empty keywords.`);
                        validationPassed = false;
                        return;
                    }
                } else { // sender, recipient, cc
                    const addressInput = groupDiv.querySelector('.condition-group-address');
                    groupSpecificData.address = addressInput.value.trim();
                    if (isGroupEnabled && !groupSpecificData.address) {
                        alert(`Enabled '${type}' condition group must have an address.`);
                        validationPassed = false;
                        return;
                    }
                }
                collectedGroupsData.push(groupSpecificData);
            });

            if (!validationPassed) return; // Stop processing if a validation failed

            conditions[type] = collectedGroupsData;

            // If main toggle is on, but no groups were added and this type requires at least one group if enabled.
            // This specific validation might be too strict if user can enable section but not add groups yet.
            // For now, an empty array `conditions[type]` means "section enabled, but no active groups".
            // The background script will need to interpret this correctly (e.g., if conditions[type] is empty, it doesn't match anything for this type).
        });

        if (!validationPassed) {
            return; // Stop form submission if any validation failed
        }

    } else { // conditionMode === 'ai'
        const userPrompt = userAiPromptInput.value.trim();
        if (!userPrompt) {
            alert('AI Prompt 不能为空！');
            return;
        }
        aiPromptDetails = {
            system: DEFAULT_SYSTEM_PROMPT,
            user: userPrompt
        };
        // For AI mode, traditional conditions are empty arrays
        conditionTypes.forEach(type => conditions[type] = []);
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
        conditionMode: conditionMode, // 'normal' or 'ai'
        conditions: conditions,       // Contains traditional conditions OR serves as a placeholder for AI mode
        aiPrompt: aiPromptDetails,    // Contains AI prompt details if mode is 'ai', else null
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
        
        rules.forEach((rule, index) => {
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

            // Order buttons cell
            const orderCell = row.insertCell();
            const upButton = document.createElement('button');
            upButton.textContent = '↑';
            upButton.title = 'Move rule up';
            upButton.disabled = index === 0; // Disable for the first rule
            upButton.addEventListener('click', () => moveRule(rule.id, 'up'));
            orderCell.appendChild(upButton);

            const downButton = document.createElement('button');
            downButton.textContent = '↓';
            downButton.title = 'Move rule down';
            downButton.disabled = index === rules.length - 1; // Disable for the last rule
            downButton.addEventListener('click', () => moveRule(rule.id, 'down'));
            orderCell.appendChild(downButton);

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

    const conditionMode = rule.conditionMode || 'normal'; // Default to normal if not set
    document.querySelector(`input[name="conditionMode"][value="${conditionMode}"]`).checked = true;

    if (conditionMode === 'ai') {
        normalConditionsContainer.style.display = 'none';
        aiConditionsContainer.style.display = 'block';
        systemPromptDisplay.value = rule.aiPrompt?.system || DEFAULT_SYSTEM_PROMPT;
        userAiPromptInput.value = rule.aiPrompt?.user || '';
        // Clear/disable normal condition fields just in case
        // (clearForm partially does this, but being explicit for AI mode is good)
        [
            subjectConditionToggle, senderConditionToggle, 
            recipientConditionToggle, ccConditionToggle, bodyConditionToggle
        ].forEach(toggle => { toggle.checked = false; });
        toggleConditionFields('subject', false);
        toggleConditionFields('sender', false);
        toggleConditionFields('recipient', false);
        toggleConditionFields('cc', false);
        toggleConditionFields('body', false);

    } else { // 'normal' or undefined (legacy rules)
        normalConditionsContainer.style.display = 'block';
        aiConditionsContainer.style.display = 'none';
        userAiPromptInput.value = ''; // Clear AI prompt for normal mode
        systemPromptDisplay.value = DEFAULT_SYSTEM_PROMPT; // Reset system prompt display

        conditionTypes.forEach(type => {
            const elements = conditionElements[type];
            const conditionGroups = rule.conditions[type]; // This is now an array of groups

            if (conditionGroups && Array.isArray(conditionGroups) && conditionGroups.length > 0) {
                elements.toggle.checked = true;
                toggleConditionFields(type, true); // Enable the section and "Add Group" button

                elements.container.innerHTML = ''; // Clear any existing UI in container for this type
                conditionGroups.forEach(groupData => {
                    // The last param to createConditionGroupUI is isOverallEnabled, which is true here
                    const groupUI = createConditionGroupUI(type, groupData, true);
                    elements.container.appendChild(groupUI);
                });
            } else {
                // No groups or not an array, ensure section is off and container empty
                elements.toggle.checked = false;
                toggleConditionFields(type, false); // Disable section and "Add Group" button
                elements.container.innerHTML = ''; // Ensure container is empty
            }
        });
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

    const conditionMode = rule.conditionMode || 'normal';

    if (conditionMode === 'ai') {
        if (rule.aiPrompt) {
            detailConditions.innerHTML += `<p><strong>条件类型:</strong> AI判断</p>`;
            detailConditions.innerHTML += `<p><strong>内置系统 Prompt:</strong> <pre style="white-space: pre-wrap; background-color: #f5f5f5; padding: 5px; border-radius: 3px;">${rule.aiPrompt.system}</pre></p>`;
            detailConditions.innerHTML += `<p><strong>用户 Prompt:</strong> <pre style="white-space: pre-wrap; background-color: #f5f5f5; padding: 5px; border-radius: 3px;">${rule.aiPrompt.user}</pre></p>`;
        } else {
            detailConditions.innerHTML += `<p><strong>条件类型:</strong> AI判断 (配置不完整)</p>`;
        }
    } else {
        detailConditions.innerHTML += `<p><strong>条件类型:</strong> 普通条件</p>`;

        conditionTypes.forEach(type => {
            const conditionGroups = rule.conditions[type]; // This is an array of groups
            const typeName = type.charAt(0).toUpperCase() + type.slice(1);

            if (conditionGroups && Array.isArray(conditionGroups) && conditionGroups.length > 0) {
                let groupsHtml = '';
                conditionGroups.forEach((group, index) => {
                    groupsHtml += `<div class="condition-group-detail ms-3 mb-2 p-2 border rounded">`;
                    groupsHtml += `<p class="mb-1"><strong>${typeName} Group ${index + 1}:</strong> ${group.enabled ? '(Enabled)' : '(Disabled)'}</p>`;
                    groupsHtml += `<p class="mb-1 ms-2">Type: ${group.type === 'include' ? 'Include' : 'Exclude'}</p>`;
                    groupsHtml += `<p class="mb-1 ms-2">Case Sensitive: ${group.caseSensitive ? 'Yes' : 'No'}</p>`;

                    if (type === 'subject' || type === 'body') {
                        const keywords = group.keywords || [];
                        let keywordDisplay = 'N/A';
                        if (keywords.length > 0) {
                             keywordDisplay = keywords.map((item, kwIndex) => {
                                let result = `"${item.keyword}"`;
                                if (kwIndex < keywords.length - 1 && item.logic) {
                                    result += ` ${item.logic.toUpperCase()} `;
                                }
                                return result;
                            }).join('');
                        }
                        groupsHtml += `<p class="mb-0 ms-2">Keywords: ${keywordDisplay}</p>`;
                    } else { // sender, recipient, cc
                        groupsHtml += `<p class="mb-0 ms-2">Address: ${group.address || 'N/A'}</p>`;
                    }
                    groupsHtml += `</div>`;
                });
                if (groupsHtml) {
                     detailConditions.innerHTML += groupsHtml;
                } else {
                    detailConditions.innerHTML += `<p><strong>${typeName}:</strong> No active groups.</p>`;
                }

            } else {
                // Compatibility with old single object structure (if any rules still use it)
                // This part might be less necessary if all rules are saved with new structure.
                const legacyCondition = rule.conditions[type];
                if (legacyCondition && typeof legacyCondition === 'object' && legacyCondition.enabled) {
                    let contentDisplay = '';
                     if (type === 'subject' || type === 'body') {
                        const keywords = legacyCondition.keywords || [];
                        contentDisplay = keywords.map((item, kwIndex) => {
                            let result = `"${item.keyword}"`;
                            if (kwIndex < keywords.length - 1 && item.logic) {
                                result += ` ${item.logic.toUpperCase()} `;
                            }
                            return result;
                        }).join('');
                        contentDisplay = `Keywords: ${contentDisplay}`;
                    } else {
                        contentDisplay = `Address: ${legacyCondition.address}`;
                    }
                    detailConditions.innerHTML += `<p><strong>${typeName}:</strong> ${legacyCondition.type === 'include' ? 'Include' : 'Exclude'} ${contentDisplay} ${legacyCondition.caseSensitive ? '(Case Sensitive)' : ''} (Legacy format)</p>`;
                } else {
                    detailConditions.innerHTML += `<p><strong>${typeName}:</strong> No conditions set.</p>`;
                }
            }
        });
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
    
    // Initialize "Add Group" button listeners and main toggle listeners
    conditionTypes.forEach(type => {
        const elements = conditionElements[type];

        // Check for essential elements for this condition type
        if (!elements.toggle || !elements.container || !elements.addBtn) {
            console.error(`Initialization skipped for condition type "${type}": Missing one or more essential DOM elements (toggle, container, or addBtn).`);
            // Optionally, disable the toggle if its dependent elements are missing
            if(elements.toggle) elements.toggle.disabled = true;
            return; // Skip setting up listeners for this type
        }

        addConditionGroupEventListener(type);

        // Setup main toggle listener
        elements.toggle.addEventListener('change', (e) => {
            toggleConditionFields(type, e.target.checked);
            // If newly checked and no groups exist, optionally add one (currently commented out)
            // if (e.target.checked && elements.container.children.length === 0) {
            //     const newGroup = createConditionGroupUI(type, null, true);
            //     elements.container.appendChild(newGroup);
            // }
        });

        // Initial state for "Add Group" button based on toggle
        if (!elements.toggle.checked) {
            elements.addBtn.style.display = 'none';
            elements.addBtn.disabled = true;
        } else {
            elements.addBtn.style.display = 'inline-block'; // Or 'block'
            elements.addBtn.disabled = false;
        }

        // Hide legacy single field wrappers
        const legacyWrapperId = `${type}ConditionFields`; // e.g. subjectConditionFields
        const legacyWrapper = document.getElementById(legacyWrapperId);
        if (legacyWrapper) {
            legacyWrapper.style.display = 'none';
        }
        if (elements.keywordsContainer) elements.keywordsContainer.style.display = 'none';
        if (elements.addressInput) elements.addressInput.style.display = 'none';
    });


    try {
        const storageResult = await chrome.storage.local.get([
            'aliMailTags', 'aliMailFolders', 'aliMailRules', 'llmApiConfigs' // Changed from geminiAiConfig
        ]);
        
        console.log('从存储直接读取的数据:', storageResult);
        
        availableTags = storageResult.aliMailTags || {};
        availableFolders = storageResult.aliMailFolders || {};
        
        if (Object.keys(availableTags).length === 0 && Object.keys(availableFolders).length === 0) {
            console.warn("提示：请确保阿里邮箱页面已打开并登录，然后刷新此页面。");
        }
        populateDropdowns();

        const rules = storageResult.aliMailRules || [];
        await renderRules();

        // 加载LLM API配置
        const llmConfigs = storageResult.llmApiConfigs || { preferredProvider: 'google', providers: { google: {}, openai: {}, anthropic: {} } };
        const googleConfig = llmConfigs.providers.google || {};
        // const openaiConfig = llmConfigs.providers.openai || {}; // For future use
        // const anthropicConfig = llmConfigs.providers.anthropic || {}; // For future use

        document.getElementById('googleApiKey').value = googleConfig.apiKey || '';
        document.getElementById('googleModelSelect').value = googleConfig.model || 'gemini-1.5-flash';
        // Populate OpenAI and Anthropic fields when implemented
        // document.getElementById('openaiApiKey').value = openaiConfig.apiKey || '';
        // document.getElementById('openaiModelSelect').value = openaiConfig.model || '';
        // document.getElementById('anthropicApiKey').value = anthropicConfig.apiKey || '';
        // document.getElementById('anthropicModelSelect').value = anthropicConfig.model || '';

        const preferredProvider = llmConfigs.preferredProvider || 'google';
        const preferredRadio = document.querySelector(`input[name="preferredApi"][value="${preferredProvider}"]`);
        if (preferredRadio) {
            preferredRadio.checked = true;
        }
        
        console.log('Options页面初始化完成');
    } catch (error) {
        console.error('Options页面初始化时出错:', error);
    }
});

// 保存LLM API配置 (was saveAiConfigBtn)
document.getElementById('saveLlmApiConfigBtn').addEventListener('click', async () => {
    const googleApiKey = document.getElementById('googleApiKey').value.trim();
    const googleModel = document.getElementById('googleModelSelect').value;
    // const openaiApiKey = document.getElementById('openaiApiKey').value.trim(); // For future use
    // const openaiModel = document.getElementById('openaiModelSelect').value; // For future use
    // const anthropicApiKey = document.getElementById('anthropicApiKey').value.trim(); // For future use
    // const anthropicModel = document.getElementById('anthropicModelSelect').value; // For future use

    const preferredProviderRadio = document.querySelector('input[name="preferredApi"]:checked');
    const preferredProvider = preferredProviderRadio ? preferredProviderRadio.value : 'google'; // Default to google if somehow none selected

    const statusElement = document.getElementById('llmConfigStatus'); // was aiConfigStatus

    // Basic validation for the currently active provider (Google)
    if (preferredProvider === 'google' && !googleApiKey) {
        alert('请输入 Google API Key。');
        statusElement.textContent = '保存失败：Google API Key 不能为空。';
        statusElement.style.color = 'red';
        return;
    }
    // Add similar validations for OpenAI and Anthropic when they are implemented

    const llmApiConfigs = {
        preferredProvider: preferredProvider,
        providers: {
            google: {
                apiKey: googleApiKey,
                model: googleModel || 'gemini-1.5-flash'
            },
            openai: {
                // apiKey: openaiApiKey, // For future use
                // model: openaiModel    // For future use
            },
            anthropic: {
                // apiKey: anthropicApiKey, // For future use
                // model: anthropicModel   // For future use
            }
        }
    };

    try {
        await chrome.storage.local.set({ llmApiConfigs: llmApiConfigs }); // Changed key name
        console.log('[Options]: LLM API 配置已保存:', llmApiConfigs);
        statusElement.textContent = 'LLM API 配置已保存！';
        statusElement.style.color = 'green';
        setTimeout(() => { statusElement.textContent = ''; }, 3000);
    } catch (error) {
        console.error('[Options]: 保存 LLM API 配置失败:', error);
        statusElement.textContent = '保存 LLM API 配置失败: ' + error.message;
        statusElement.style.color = 'red';
    }
});

// Function to move a rule up or down
async function moveRule(ruleId, direction) {
    try {
        const result = await chrome.storage.local.get('aliMailRules');
        let rules = result.aliMailRules || [];
        
        const ruleIndex = rules.findIndex(r => r.id === ruleId);
        if (ruleIndex === -1) {
            console.error('Rule not found for moving:', ruleId);
            alert('操作失败：未找到规则。');
            return;
        }

        if (direction === 'up' && ruleIndex > 0) {
            [rules[ruleIndex - 1], rules[ruleIndex]] = [rules[ruleIndex], rules[ruleIndex - 1]];
        } else if (direction === 'down' && ruleIndex < rules.length - 1) {
            [rules[ruleIndex + 1], rules[ruleIndex]] = [rules[ruleIndex], rules[ruleIndex + 1]];
        } else {
            // Already at top or bottom, or invalid direction
            return; 
        }

        await chrome.storage.local.set({ aliMailRules: rules });
        await renderRules(); // Re-render the list to reflect the new order
    } catch (error) {
        console.error('Error moving rule:', error);
        alert('移动规则时出错: ' + error.message);
    }
}

// Event listeners for condition mode radio buttons
conditionModeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
        if (e.target.value === 'ai') {
            normalConditionsContainer.style.display = 'none';
            aiConditionsContainer.style.display = 'block';
            systemPromptDisplay.value = DEFAULT_SYSTEM_PROMPT; // Ensure it's set when switching
        } else {
            normalConditionsContainer.style.display = 'block';
            aiConditionsContainer.style.display = 'none';
        }
    });
});
