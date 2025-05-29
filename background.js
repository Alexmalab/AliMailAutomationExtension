// background.js - Chrome Extension Service Worker

let userRules = []; // 存储用户定义的规则

// ===============================================
// 规则管理
// ===============================================

// 从存储加载规则
async function loadRules() {
    const result = await chrome.storage.local.get('aliMailRules');
    userRules = result.aliMailRules || [];
    console.log("[Background]: 已加载规则:", userRules);
}

// 保存规则到存储
async function saveRules() {
    await chrome.storage.local.set({ aliMailRules: userRules });
    console.log("[Background]: 规则已保存:", userRules);
}

// 添加/更新规则
function addOrUpdateRule(rule) {
    const index = userRules.findIndex(r => r.id === rule.id);
    if (index !== -1) {
        userRules[index] = rule;
    } else {
        rule.id = Date.now().toString(); // 简单生成唯一ID
        userRules.push(rule);
    }
    saveRules();
}

// 删除规则
function deleteRule(ruleId) {
    userRules = userRules.filter(r => r.id !== ruleId);
    saveRules();
}

// 切换规则状态
function toggleRuleStatus(ruleId) {
    const rule = userRules.find(r => r.id === ruleId);
    if (rule) {
        rule.enabled = !rule.enabled;
        saveRules();
    }
}

// ===============================================
// 关键字匹配引擎 - 支持复杂的AND/OR逻辑组合
// ===============================================

/**
 * 评估关键字条件，支持复杂的AND/OR逻辑组合
 * @param {Array} keywords 关键字数组，格式：[{keyword: "关键字", logic: "or|and"}, ...]
 * @param {string} text 要匹配的文本内容
 * @param {boolean} caseSensitive 是否区分大小写
 * @param {string} conditionType 条件类型："include" 或 "exclude"
 * @returns {boolean} 匹配结果
 */
function evaluateKeywordCondition(keywords, text, caseSensitive = false, conditionType = 'include') {
    if (!keywords || keywords.length === 0) {
        return true; // 没有关键字条件，默认匹配
    }

    // 处理大小写
    const textToMatch = caseSensitive ? text : text.toLowerCase();
    
    // 将关键字转换为匹配用的格式
    const processedKeywords = keywords.map(item => {
        if (typeof item === 'string') {
            // 兼容旧格式
            return {
                keyword: caseSensitive ? item : item.toLowerCase(),
                logic: 'or'
            };
        } else {
            // 新格式
            return {
                keyword: caseSensitive ? item.keyword : item.keyword.toLowerCase(),
                logic: item.logic || 'or'
            };
        }
    });

    // 构建逻辑表达式并计算结果
    const result = evaluateLogicalExpression(processedKeywords, textToMatch);
    
    // 根据条件类型返回结果
    if (conditionType === 'include') {
        return result;
    } else { // 'exclude'
        return !result;
    }
}

/**
 * 检查地址（发件人/收件人）是否匹配指定的条件
 * @param {Object} condition 条件对象 {enabled, type, address, caseSensitive}
 * @param {Object | Array<Object>} addressContent 要检查的地址内容 (Object {displayName, email} for sender, Array for recipients)
 * @param {boolean} isRecipientList Indicates if addressContent is an array of recipient objects
 * @returns {boolean} 是否匹配
 */
function checkAddressCondition(condition, addressContent, isRecipientList = false) {
    if (!condition || !condition.enabled || !addressContent) {
        return true; // 条件未启用或内容为空，默认匹配
    }

    const ruleAddress = condition.caseSensitive ? condition.address : condition.address.toLowerCase();

    if (isRecipientList) { // For Recipient Array
        if (!Array.isArray(addressContent)) {
            console.warn("[checkAddressCondition] Expected recipient list (array) but got:", addressContent);
            return false; 
        }
        
        let matchFound = false;
        for (const recipientObj of addressContent) {
            const email = recipientObj.email || '';
            const displayName = recipientObj.displayName || '';

            const emailToMatch = condition.caseSensitive ? email : email.toLowerCase();
            const displayNameToMatch = condition.caseSensitive ? displayName : displayName.toLowerCase();

            if (emailToMatch.includes(ruleAddress) || displayNameToMatch.includes(ruleAddress)) {
                matchFound = true;
                break;
            }
        }
        return condition.type === 'include' ? matchFound : !matchFound;

    } else { // For Sender Object {displayName, email}
        if (typeof addressContent !== 'object' || addressContent === null) {
            console.warn("[checkAddressCondition] Expected sender object but got:", addressContent);
            return false;
        }
        const email = addressContent.email || '';
        const displayName = addressContent.displayName || '';
        const emailToMatch = condition.caseSensitive ? email : email.toLowerCase();
        const displayNameToMatch = condition.caseSensitive ? displayName : displayName.toLowerCase();
        
        let matchFound = false;
        if (emailToMatch.includes(ruleAddress) || displayNameToMatch.includes(ruleAddress)) {
            matchFound = true;
        }
        return condition.type === 'include' ? matchFound : !matchFound;
    }
}

/**
 * 评估逻辑表达式，正确处理AND/OR优先级
 * @param {Array} processedKeywords 处理后的关键字数组
 * @param {string} textToMatch 要匹配的文本
 * @returns {boolean} 逻辑表达式的结果
 */
function evaluateLogicalExpression(processedKeywords, textToMatch) {
    if (processedKeywords.length === 0) {
        return true;
    }
    
    if (processedKeywords.length === 1) {
        return textToMatch.includes(processedKeywords[0].keyword);
    }

    // 将关键字分组，按AND操作符分割成OR组
    const orGroups = [];
    let currentAndGroup = [];
    
    for (let i = 0; i < processedKeywords.length; i++) {
        const item = processedKeywords[i];
        currentAndGroup.push(item.keyword);
        
        // 如果当前项的逻辑是OR，或者是最后一项，结束当前AND组
        if (item.logic === 'or' || i === processedKeywords.length - 1) {
            orGroups.push([...currentAndGroup]);
            currentAndGroup = [];
        }
    }
    
    // 计算每个AND组的结果
    const andGroupResults = orGroups.map(andGroup => {
        // AND组内所有关键字都必须匹配
        return andGroup.every(keyword => textToMatch.includes(keyword));
    });
    
    // OR组之间只要有一个为真即可
    return andGroupResults.some(result => result);
}

/**
 * 检查邮件是否匹配指定的条件
 * @param {Object} condition 条件对象 {enabled, type, keywords, caseSensitive}
 * @param {string} content 要检查的内容（主题或正文）
 * @returns {boolean} 是否匹配
 */
function checkCondition(condition, content) {
    if (!condition || !condition.enabled || !content) {
        return true; // 条件未启用或内容为空，默认匹配
    }
    
    return evaluateKeywordCondition(
        condition.keywords,
        content,
        condition.caseSensitive || false,
        condition.type || 'include'
    );
}

// ===============================================
// 规则引擎 - 重写以支持主题和正文条件
// ===============================================

/**
 * 运行规则引擎对邮件进行匹配和处理
 * @param {string} mailIdInput 邮件的mailId
 * @param {string} bodyContentInput 邮件的HTML或纯文本正文 (可能为null)
 * @param {string} subjectInput 邮件主题
 * @param {Object} senderInput 邮件发件人 (Object {displayName, email} or null)
 * @param {Array<Object>} recipientInput 邮件收件人 (Array of {displayName, email} or null)
 * @param {Array<Object>} ccRecipientsInput 邮件抄送人 (Array of {displayName, email} or null)
 * @param {number} tabId 邮件所在的Tab ID，用于向Content Script发送消息
 */
async function runRulesEngine(mailIdInput, bodyContentInput, subjectInput, senderInput, recipientInput, ccRecipientsInput, tabId) {
    let currentMailId = mailIdInput;
    let currentBodyContent = bodyContentInput;
    let currentSubject = subjectInput;
    let currentSender = senderInput;
    let currentRecipient = recipientInput;
    let currentCcRecipients = ccRecipientsInput;

    console.log(`[Background]: 运行规则引擎处理邮件 ${currentMailId}...`);
    console.log(`[Background]: 邮件主题: "${currentSubject}", 发件人:`, currentSender, ", 收件人:", currentRecipient, ", 抄送人:", currentCcRecipients);
    if (currentBodyContent) {
        console.log(`[Background]: 邮件正文长度: ${currentBodyContent.length} 字符`);
    }
    console.log(`[Background]: 当前有 ${userRules.length} 条规则`);
    
    for (const rule of userRules) {
        if (!rule.enabled) {
            console.log(`[Background]: 跳过未启用的规则 "${rule.name}"`);
            continue; // 跳过未启用的规则
        }

        console.log(`[Background]: 检查规则 "${rule.name}" for mail ID ${currentMailId}...`);
        console.log(`[Background]: 规则详情:`, JSON.stringify(rule, null, 2));

        // --- 匹配条件 ---
        let conditionMet = true;
        const requiresBody = rule.conditions?.body?.enabled;
        const requiresRecipientRule = rule.conditions?.recipient?.enabled;
        const requiresCcRule = rule.conditions?.cc?.enabled;

        // 检查发件人条件
        if (rule.conditions?.sender?.enabled) {
            if (!currentSender) {
                console.warn(`[Background]: 发件人信息缺失，规则 "${rule.name}" 的发件人条件无法评估，若无后续获取则视为不匹配。`);
                // This situation should be rare if initial fetch logic works.
                // If sender is critical and missing, conditionMet might become false after fetch attempt.
            } else {
                const senderMatch = checkAddressCondition(rule.conditions.sender, currentSender, false);
                console.log(`[Background]: 发件人条件匹配结果: ${senderMatch}`);
                conditionMet = conditionMet && senderMatch;
            }
        }
        
        // 检查收件人条件
        if (rule.conditions?.recipient?.enabled) {
            if (!currentRecipient) {
                 console.log(`[Background]: 规则 "${rule.name}" 需要收件人信息，当前缺失。`);
            } else {
                const recipientMatch = checkAddressCondition(rule.conditions.recipient, currentRecipient, true);
                console.log(`[Background]: 收件人条件匹配结果: ${recipientMatch}`);
                conditionMet = conditionMet && recipientMatch;
            }
        }

        // 检查抄送条件
        if (rule.conditions?.cc?.enabled) {
            if (!currentCcRecipients) {
                 console.log(`[Background]: 规则 "${rule.name}" 需要抄送信息，当前缺失。`);
            } else {
                const ccMatch = checkAddressCondition(rule.conditions.cc, currentCcRecipients, true);
                console.log(`[Background]: 抄送条件匹配结果: ${ccMatch}`);
                conditionMet = conditionMet && ccMatch;
            }
        }

        // 检查主题条件
        if (rule.conditions?.subject?.enabled) {
            const subjectMatch = checkCondition(rule.conditions.subject, currentSubject);
            console.log(`[Background]: 主题条件匹配结果: ${subjectMatch}`);
            conditionMet = conditionMet && subjectMatch;
        }

        // 如果目前条件已不满足，则跳过此规则
        if (!conditionMet) {
            console.log(`[Background]: 规则 "${rule.name}" 基于头部信息不匹配邮件 ${currentMailId}`);
            continue;
        }

        // 如果需要正文、收件人或抄送信息，但当前没有，则获取完整邮件信息
        // This fetch is for the *current rule's needs*.
        const needsFurtherDataFetch = (requiresBody && !currentBodyContent) ||
                                   (requiresRecipientRule && !currentRecipient) ||
                                   (requiresCcRule && !currentCcRecipients);

        if (needsFurtherDataFetch) {
            console.log(`[Background]: 规则 "${rule.name}" 需要正文/收件人/抄送信息，请求完整邮件内容 for ${currentMailId}`);
            try {
                const mailDetails = await chrome.tabs.sendMessage(tabId, {
                    action: "fetchMailBody",
                    mailId: currentMailId // Use currentMailId
                });

                if (mailDetails && mailDetails.success && mailDetails.data) {
                    const fullApiData = mailDetails.data.data;
                    console.log("[Background]: Fetched fullApiData (for rule '"+rule.name+"'):", JSON.stringify(fullApiData, null, 2));
                    
                    // Update the main state variables for subsequent rules as well
                    currentBodyContent = currentBodyContent || fullApiData.body || '';
                    console.log(`[Background]: currentBodyContent for rule '${rule.name}' after fetch update (length: ${currentBodyContent ? currentBodyContent.length : 0}): '${currentBodyContent.substring(0, 200)}${currentBodyContent && currentBodyContent.length > 200 ? '...' : ''}'`);
                    
                    if ((!currentSender || typeof currentSender.email === 'undefined') && fullApiData.from) {
                         if (typeof fullApiData.from === 'object') {
                            currentSender = {
                                displayName: fullApiData.from.displayName || '',
                                email: fullApiData.from.email || ''
                            };
                        } else if (typeof fullApiData.from === 'string') {
                            currentSender = { displayName: fullApiData.from, email: '' };
                        }
                        console.log("[Background]: Sender updated from fullApiData:", currentSender);
                    }
                    
                    if (mailDetails.recipient) { // mailDetails.recipient IS the array
                        currentRecipient = mailDetails.recipient; 
                        console.log("[Background]: Recipient array updated from mailDetails:", currentRecipient);
                    }
                    if (mailDetails.ccRecipients) {
                        currentCcRecipients = mailDetails.ccRecipients;
                        console.log("[Background]: CC Recipient array updated from mailDetails:", currentCcRecipients);
                    }

                    console.log(`[Background]: 成功获取完整邮件内容 for ${currentMailId}. Updated Sender:`, currentSender, ", Updated Recipient(To):", currentRecipient ? currentRecipient.length : 0, ", Updated CC: ", currentCcRecipients ? currentCcRecipients.length : 0 );
                    
                    // Re-evaluate conditions based on newly fetched data
                    // Important: AND with existing conditionMet status
                    let tempConditionMetAfterFetch = true;
                    if (rule.conditions?.sender?.enabled) {
                        if (!currentSender) { tempConditionMetAfterFetch = false; } // Should not happen if fetch was for sender
                        else {
                            const senderMatch = checkAddressCondition(rule.conditions.sender, currentSender, false);
                            console.log(`[Background]: (完整邮件后) 发件人条件匹配结果: ${senderMatch}`);
                            tempConditionMetAfterFetch = tempConditionMetAfterFetch && senderMatch;
                        }
                    }

                    if (requiresRecipientRule) { // Check enabled flag directly
                        if (!currentRecipient) {
                            console.warn(`[Background]: 收件人信息在获取完整邮件后仍然缺失，无法评估规则 "${rule.name}" 的收件人条件`);
                            tempConditionMetAfterFetch = false;
                        } else {
                            const recipientMatch = checkAddressCondition(rule.conditions.recipient, currentRecipient, true);
                            console.log(`[Background]: (完整邮件后) 收件人条件匹配结果: ${recipientMatch}`);
                            tempConditionMetAfterFetch = tempConditionMetAfterFetch && recipientMatch;
                        }
                    }
                    
                    if (requiresCcRule) { // Check enabled flag directly
                        if (!currentCcRecipients) {
                            console.warn(`[Background]: 抄送信息在获取完整邮件后仍然缺失，无法评估规则 "${rule.name}" 的抄送条件`);
                            tempConditionMetAfterFetch = false;
                        } else {
                            const ccMatch = checkAddressCondition(rule.conditions.cc, currentCcRecipients, true);
                            console.log(`[Background]: (完整邮件后) 抄送条件匹配结果: ${ccMatch}`);
                            tempConditionMetAfterFetch = tempConditionMetAfterFetch && ccMatch;
                        }
                    }
                    conditionMet = conditionMet && tempConditionMetAfterFetch;

                } else {
                    console.error(`[Background]: 获取邮件 ${currentMailId} 完整内容失败，无法评估依赖正文/收件人的规则 "${rule.name}"`);
                    // If fetch failed for data that was required for conditions, those conditions might fail or be unevaluable.
                    // Set conditionMet to false if critical data for *this rule* is still missing.
                    if (requiresRecipientRule && !currentRecipient) conditionMet = false;
                    if (requiresCcRule && !currentCcRecipients) conditionMet = false;
                    if (requiresBody && !currentBodyContent && rule.conditions.body.enabled) conditionMet = false; // If body was target of fetch
                }
            } catch (error) {
                console.error(`[Background]: 获取邮件 ${currentMailId} 完整内容时出错:`, error);
                if (requiresRecipientRule && !currentRecipient) conditionMet = false;
                if (requiresCcRule && !currentCcRecipients) conditionMet = false;
                if (requiresBody && !currentBodyContent && rule.conditions.body.enabled) conditionMet = false;
            }
        }
        
        // 如果仍然不匹配 (e.g. recipient check failed after fetch)
        if (!conditionMet) {
            console.log(`[Background]: 规则 "${rule.name}" 在获取完整信息后不匹配邮件 ${currentMailId}`);
            continue;
        }

        // 检查正文条件 (if required and body is available)
        if (requiresBody) { // True if rule.conditions.body.enabled
            if (!currentBodyContent) { // Check currentBodyContent, which would have been updated by fetch if successful
                 console.warn(`[Background]: 规则 "${rule.name}" 的正文条件启用，但正文内容最终无法获取。规则不匹配。`);
                 conditionMet = false; // CRITICAL FIX: If body required by rule, but no content, rule fails.
            } else {
                const bodyMatch = checkCondition(rule.conditions.body, currentBodyContent);
                console.log(`[Background]: 正文条件匹配结果: ${bodyMatch}`);
                conditionMet = conditionMet && bodyMatch;
            }
        }

        if (conditionMet) {
            console.log(`[Background]: 规则 "${rule.name}" 匹配邮件 ${currentMailId} 成功。执行操作...`);
            
            const execResult = await executeRuleActions(rule, currentMailId, tabId);
            currentMailId = execResult.newMailId; // Update currentMailId for next iteration

            if (execResult.mailDataFromMove) {
                const movedMailData = execResult.mailDataFromMove;
                console.log("[Background]: Mail moved. Updating subject/sender from move data:", movedMailData);
                currentSubject = movedMailData.subject || movedMailData.encSubject || currentSubject;
                if (movedMailData.from) {
                    if (typeof movedMailData.from === 'object') {
                        currentSender = { displayName: movedMailData.from.displayName || '', email: movedMailData.from.email || '' };
                    } else if (typeof movedMailData.from === 'string') {
                        const match = movedMailData.from.match(/(.*)<(.*)>/);
                        if (match && match[1] && match[2]) {
                            currentSender = { displayName: match[1].trim(), email: match[2].trim() };
                        } else {
                            currentSender = { displayName: movedMailData.from, email: '' };
                        }
                    }
                }
                // Note: recipient/cc are more reliably updated by fetchMailBody if needed by a subsequent rule
            }
            
            if (rule.action && rule.action.stopProcessing) {
                console.log(`[Background]: 规则 "${rule.name}" 包含 "停止处理其他规则"，处理邮件 ${currentMailId} 结束。`);
                break; 
            }
        } else {
            console.log(`[Background]: 规则 "${rule.name}" 不匹配邮件 ${currentMailId}`);
        }
    }
}

/**
 * 执行规则的操作
 * @param {Object} rule 规则对象
 * @param {string} mailId 邮件ID
 * @param {number} tabId Tab ID
 */
async function executeRuleActions(rule, mailId, tabId) {
    console.log(`[Background]: 开始执行规则操作，原始mailId: ${mailId}`);
    
    // 获取最新的标签和文件夹数据
    const storageData = await chrome.storage.local.get(['aliMailTags', 'aliMailFolders']);
    const currentTags = storageData.aliMailTags || {};
    const currentFolders = storageData.aliMailFolders || {};

    // 检查是否是删除操作
    if (rule.action && rule.action.type === 'delete') {
        console.log(`[Background]: 执行删除操作 - 邮件 ${mailId}`);
        // TODO: 实现删除操作
        return { newMailId: mailId, mailDataFromMove: null }; // Return original mailId if no move
    }

    let currentMailIdForActions = mailId; // Use this for actions within this function
    let mailDataAfterMove = null; // To store mailData if a move happens
    
    // ========================================
    // 第一阶段：快速操作（不改变mailId的操作）
    // ========================================
    
    // 设置标签（优先执行）
    if (rule.action && rule.action.setLabel) {
        const labelsToSet = Array.isArray(rule.action.setLabel) ? rule.action.setLabel : [rule.action.setLabel];
        const tagIds = [];
        
        for (const labelName of labelsToSet) {
            if (currentTags[labelName]) {
                tagIds.push(currentTags[labelName]);
            } else {
                console.warn(`[Background]: 标签 "${labelName}" 不存在，跳过`);
            }
        }
        
        if (tagIds.length > 0) {
            console.log(`[Background]: 为邮件 ${currentMailIdForActions} 设置标签: ${labelsToSet.join(', ')} (IDs: ${tagIds.join(', ')})`);
            try {
                const response = await chrome.tabs.sendMessage(tabId, {
                    action: "applyLabel",
                    mailIds: [currentMailIdForActions],
                    tagIds: tagIds
                });
                console.log("[Background]: 设置标签操作结果:", response);
            } catch (error) {
                console.error("[Background]: 设置标签操作失败:", error);
            }
        }
    }

    // 标记为已读（优先执行）
    if (rule.action && rule.action.markAsRead) {
        console.log(`[Background]: 标记邮件 ${currentMailIdForActions} 为已读`);
        try {
            const response = await chrome.tabs.sendMessage(tabId, {
                action: "markRead",
                mailId: currentMailIdForActions,
                isRead: true
            });
            console.log("[Background]: 标记为已读操作结果:", response);
        } catch (error) {
            console.error("[Background]: 标记为已读操作失败:", error);
        }
    }

    // ========================================
    // 第二阶段：可能改变mailId的操作
    // ========================================
    
    // 移动到文件夹（最后执行，因为会改变mailId）
    if (rule.action && rule.action.moveToFolder && currentFolders[rule.action.moveToFolder]) {
        const folderId = currentFolders[rule.action.moveToFolder];
        const folderName = rule.action.moveToFolder;
        
        console.log(`[Background]: 移动邮件 ${currentMailIdForActions} 到文件夹 "${folderName}" (ID: ${folderId})`);
        
        try {
            // 提取原始唯一ID
            const originalUniqueId = extractUniqueId(currentMailIdForActions);
            console.log(`[Background]: 提取到唯一ID: ${originalUniqueId}`);
            
            // 执行移动操作
            const moveResponse = await chrome.tabs.sendMessage(tabId, {
                action: "moveMail",
                mailId: currentMailIdForActions,
                folderId: folderId
            });
            
            console.log("[Background]: 移动邮件操作结果:", moveResponse);
            
            if (moveResponse.success) {
                // 验证移动结果并获取新的mailId
                console.log(`[Background]: 验证邮件移动到文件夹 ${folderId}...`);
                
                const verifyResponse = await chrome.tabs.sendMessage(tabId, {
                    action: "verifyMailMove",
                    originalUniqueId: originalUniqueId,
                    targetFolderId: folderId,
                    maxResults: 5
                });
                
                console.log("[Background]: 移动验证结果:", verifyResponse);
                
                if (verifyResponse.success && verifyResponse.found) {
                    const newMailId = verifyResponse.newMailId;
                    console.log(`[Background]: ✅ 邮件移动验证成功，mailId更新: ${currentMailIdForActions} -> ${newMailId}`);
                    currentMailIdForActions = newMailId; // Update for return
                    mailDataAfterMove = verifyResponse.mailData; // Capture mailData
                } else {
                    console.error(`[Background]: ❌ 邮件移动验证失败，无法找到移动后的邮件`);
                    console.error(`[Background]: 验证详情:`, verifyResponse);
                }
            } else {
                console.error("[Background]: 移动邮件失败:", moveResponse.error);
            }
            
        } catch (error) {
            console.error("[Background]: 移动邮件操作失败:", error);
        }
    }
    
    console.log(`[Background]: 规则操作执行完成，最终mailId: ${currentMailIdForActions}`);
    return { newMailId: currentMailIdForActions, mailDataFromMove: mailDataAfterMove };
}

/**
 * 从mailId中提取唯一标识符部分
 * @param {string} mailId 完整的邮件ID，格式如 "2_0:DzzzzyLmbnF$---.d0sJjml"
 * @returns {string} 唯一标识符部分，如 "DzzzzyLmbnF$---.d0sJjml"
 */
function extractUniqueId(mailId) {
    const parts = mailId.split(':');
    return parts.length > 1 ? parts[1] : mailId;
}

/**
 * 从mailId中提取文件夹ID
 * @param {string} mailId 完整的邮件ID，格式如 "2_0:DzzzzyLmbnF$---.d0sJjml"
 * @returns {string} 文件夹ID，如 "2"
 */
function extractFolderIdFromMailId(mailId) {
    const parts = mailId.split('_');
    return parts.length > 0 ? parts[0] : '2'; // 默认返回收件箱ID
}

/**
 * 手动执行规则 - 遍历收件箱未读邮件并应用规则
 * @param {number} tabId 阿里邮箱页面的Tab ID
 * @returns {Promise<Object>} 执行结果
 */
async function manualExecuteRules(tabId) {
    console.log(`[Background]: 开始手动执行规则，Tab ID: ${tabId}`);
    
    try {
        // 向 Content Script 请求获取收件箱未读邮件列表
        const response = await chrome.tabs.sendMessage(tabId, {
            action: "getInboxUnreadMails"
        });

        if (!response || !response.success) {
            return { 
                success: false, 
                error: response?.error || "获取未读邮件列表失败" 
            };
        }

        const unreadMails = response.mails || [];
        console.log(`[Background]: 获取到 ${unreadMails.length} 封未读邮件`);

        let processedCount = 0;

        // 遍历每封未读邮件
        for (const mail of unreadMails) {
            try {
                // 获取邮件正文
                const bodyResponse = await chrome.tabs.sendMessage(tabId, {
                    action: "fetchMailBody",
                    mailId: mail.mailId
                });

                if (bodyResponse && bodyResponse.success && bodyResponse.data && bodyResponse.data.data) {
                    const mailData = bodyResponse.data.data;
                    const bodyContent = mailData.htmlBody || mailData.textBody || '';
                    const subject = mailData.subject || mailData.encSubject || '无主题';

                    // 对这封邮件运行规则引擎
                    await runRulesEngine(mail.mailId, bodyContent, subject, tabId);
                    processedCount++;
                    
                    console.log(`[Background]: 已处理邮件 ${mail.mailId} (${processedCount}/${unreadMails.length})`);
                } else {
                    console.warn(`[Background]: 无法获取邮件 ${mail.mailId} 的正文`);
                }
            } catch (error) {
                console.error(`[Background]: 处理邮件 ${mail.mailId} 时出错:`, error);
            }
        }

        return { 
            success: true, 
            processedCount: processedCount,
            totalCount: unreadMails.length
        };

    } catch (error) {
        console.error("[Background]: 手动执行规则时出错:", error);
        return { 
            success: false, 
            error: error.message 
        };
    }
}

// ===============================================
// 监听 Content Script 的消息
// ===============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 处理来自 Options Page 的消息
    if (!sender.tab) {
        // 来自 Options Page 或 Popup 的消息
        if (message.action === "saveRule") {
            addOrUpdateRule(message.rule);
            sendResponse({ success: true });
            return;
        } else if (message.action === "getRules") {
            sendResponse(userRules);
            return;
        } else if (message.action === "deleteRule") {
            deleteRule(message.ruleId);
            sendResponse({ success: true });
            return;
        } else if (message.action === "toggleRuleStatus") {
            toggleRuleStatus(message.ruleId);
            sendResponse({ success: true });
            return;
        } else if (message.action === "getTagsAndFolders") {
            console.log("[Background]: 收到 getTagsAndFolders 请求");
            
            // 直接从存储读取标签和文件夹数据
            chrome.storage.local.get(['aliMailTags', 'aliMailFolders']).then(result => {
                const tags = result.aliMailTags || {};
                const folders = result.aliMailFolders || {};
                
                console.log("[Background]: 从存储读取标签:", tags);
                console.log("[Background]: 从存储读取文件夹:", folders);
                
                const response = { 
                    success: true, 
                    tags: tags, 
                    folders: folders 
                };
                
                console.log("[Background]: 发送响应:", response);
                sendResponse(response);
            }).catch(error => {
                console.error("[Background]: 读取存储数据失败:", error);
                sendResponse({ 
                    success: false, 
                    error: error.message,
                    tags: {},
                    folders: {}
                });
            });
            return true; // 异步响应
        } else if (message.action === "manualExecuteRules") {
            // 手动执行规则 - 遍历收件箱未读邮件
            manualExecuteRules(message.tabId).then(sendResponse);
            return true; // 异步响应
        }
    }

    // 确保消息来自阿里邮箱页面
    if (!sender.tab || !sender.tab.url || !sender.tab.url.startsWith("https://qiye.aliyun.com/alimail/")) {
        return;
    }

    if (message.action === "newMailDetected") {
        console.log(`[Background]: 收到Content Script的新邮件通知: ${message.mailId}`);
        console.log(`[Background]: 新邮件主题: "${message.subject}"`);
        console.log(`[Background]: 新邮件发件人: "${message.sender}"`);
        
        // 初始邮件信息，不包含正文
        const initialMailInfo = {
            mailId: message.mailId,
            subject: message.subject,
            sender: message.sender,
            // recipient: message.recipient, // Assuming recipient is not available from initial notification
            bodyContent: null, // 正文初始为null
            tabId: sender.tab.id
        };

        // 直接运行规则引擎，它会按需获取正文
        runRulesEngine(
            initialMailInfo.mailId, 
            initialMailInfo.bodyContent, 
            initialMailInfo.subject, 
            initialMailInfo.sender,
            null, // Recipient initially null
            null, // CC Recipients initially null
            initialMailInfo.tabId
        );

    } else if (message.action === "newMailIdDetected") {
        // 新增：处理只有mailId没有主题的新邮件通知
        console.log(`[Background]: 收到新邮件ID通知: ${message.mailId}，需要主动查询邮件信息`);
        
        // 提取文件夹ID来确定查询范围
        const folderId = extractFolderIdFromMailId(message.mailId);
        console.log(`[Background]: 从mailId提取文件夹ID: ${folderId}`);
        
        // 主动查询该文件夹的邮件列表，查找匹配的邮件
        chrome.tabs.sendMessage(sender.tab.id, {
            action: "queryMailList",
            folderIds: [folderId],
            unreadOnly: false,
            maxLength: 10,  // 只查询最新的10封邮件
            offset: 0
        }).then(response => {
            if (response && response.success && response.mails) {
                console.log(`[Background]: 查询到 ${response.mails.length} 封邮件，查找匹配的邮件`);
                
                // 查找匹配的邮件
                const targetMail = response.mails.find(mail => mail.mailId === message.mailId);
                if (targetMail) {
                    const subject = targetMail.subject || targetMail.encSubject || '无主题';
                    
                    let senderObject = null; // Changed from senderName to senderObject
                    if (targetMail.from && typeof targetMail.from === 'object') {
                        senderObject = { 
                            displayName: targetMail.from.displayName || '', 
                            email: targetMail.from.email || '' 
                        };
                    } else if (typeof targetMail.from === 'string') { 
                        // Try to parse "DisplayName <email@example.com>"
                        const match = targetMail.from.match(/(.*)<(.*)>/);
                        if (match && match[1] && match[2]) {
                            senderObject = { displayName: match[1].trim(), email: match[2].trim() };
                        } else { // Simple string
                            senderObject = { displayName: targetMail.from, email: '' };
                        }
                    }
                    
                    // Recipient is intentionally kept null here, to be fetched by runRulesEngine if a rule needs it.
                    console.log(`[Background]: 找到匹配邮件 (from queryMailList) - 主题: "${subject}", 发件人对象:`, senderObject);
                    
                    // 运行规则引擎，它会按需获取正文和收件人信息
                    runRulesEngine(
                        message.mailId, 
                        null, // 正文初始为null
                        subject, 
                        senderObject, // Pass the sender object
                        null, // Recipient initially null
                        null, // CC Recipients initially null
                        sender.tab.id
                    );
                } else {
                    console.warn(`[Background]: 在查询结果中未找到mailId为 ${message.mailId} 的邮件`);
                }
            } else {
                console.error("[Background]: 查询邮件列表失败:", response?.error);
            }
        }).catch(error => {
            console.error("[Background]: 查询邮件列表时出错:", error);
        });
    } else if (message.action === "mailContentFetched") {
        console.log(`[Background]: 收到Content Script的邮件正文: ${message.mailId}`);
        // 邮件正文已获取，现在运行规则引擎
        // This path might be redundant if runRulesEngine fetches body itself.
        // However, if manual fetch was triggered for some reason, we can still use it.
        // Ensure sender and recipient are in the expected object/array format if coming through here.
        let parsedSender = message.sender;
        if (typeof message.sender === 'string') { // If old format string comes through
             const match = message.sender.match(/(.*)<(.*)>/);
             if (match && match[1] && match[2]) {
                parsedSender = { displayName: match[1].trim(), email: match[2].trim() };
            } else {
                parsedSender = { displayName: message.sender, email: '' };
            }
        }

        runRulesEngine(message.mailId, message.body, message.subject, parsedSender, message.recipient, message.ccRecipients, sender.tab.id);
    } else if (message.action === "tagsUpdated") {
        console.log("[Background]: 收到标签更新通知:", message.tags);
        // 标签数据现在直接由 Content Script 保存到存储，无需在这里处理
    } else if (message.action === "foldersUpdated") {
        console.log("[Background]: 收到文件夹更新通知:", message.folders);
        // 文件夹数据现在直接由 Content Script 保存到存储，无需在这里处理
    }
});

// ===============================================
// 初始化
// ===============================================

// 标签和文件夹数据现在由 Content Script 直接保存到存储中
// 不再需要主动获取数据的函数

// 后台服务工作者启动时加载规则
loadRules();

// 在后台脚本启动时，主动向阿里邮箱页面注入Content Script
// 确保即使页面在扩展安装前就已打开也能工作
chrome.tabs.query({url: "https://qiye.aliyun.com/alimail/*"}, (tabs) => {
    tabs.forEach(tab => {
        // 检查Content Script是否已注入，避免重复注入
        // 简单方式：尝试发送一个消息，如果失败则注入
        chrome.tabs.sendMessage(tab.id, {action: "ping"})
            .catch(() => {
                console.log(`[Background]: 尝试向Tab ${tab.id} 注入Content Script...`);
                chrome.scripting.executeScript({
                    target: {tabId: tab.id},
                    files: ['content.js']
                });
            });
    });
});

// 定期请求 Content Script 发送最新的标签和文件夹数据，以保持缓存同步
// 尤其是在 Options Page 打开之前，确保数据是最新的
// 这个可以通过 popup.js 或 options.js 主动请求，或者 Background 定期发送
// 这里为了简化，假设 Content Script 劫持 getMailNavData.txt 就能自动更新 Background
// 如果需要 Background 主动触发，则需要：
// chrome.tabs.sendMessage(tabId, { action: "getMailNavData" });

// ===============================================
// 测试函数 - 验证关键字匹配引擎
// ===============================================

/**
 * 测试关键字匹配引擎的各种场景
 */
function testKeywordEngine() {
    console.log('=== 开始测试关键字匹配引擎 ===');
    
    const testCases = [
        {
            name: '单个关键字匹配',
            keywords: [{keyword: 'test', logic: 'or'}],
            text: 'This is a test message',
            caseSensitive: false,
            conditionType: 'include',
            expected: true
        },
        {
            name: '单个关键字不匹配',
            keywords: [{keyword: 'hello', logic: 'or'}],
            text: 'This is a test message',
            caseSensitive: false,
            conditionType: 'include',
            expected: false
        },
        {
            name: 'OR逻辑 - 匹配第一个',
            keywords: [
                {keyword: 'test', logic: 'or'},
                {keyword: 'hello', logic: 'or'}
            ],
            text: 'This is a test message',
            caseSensitive: false,
            conditionType: 'include',
            expected: true
        },
        {
            name: 'OR逻辑 - 匹配第二个',
            keywords: [
                {keyword: 'hello', logic: 'or'},
                {keyword: 'message', logic: 'or'}
            ],
            text: 'This is a test message',
            caseSensitive: false,
            conditionType: 'include',
            expected: true
        },
        {
            name: 'AND逻辑 - 都匹配',
            keywords: [
                {keyword: 'test', logic: 'and'},
                {keyword: 'message', logic: 'and'}
            ],
            text: 'This is a test message',
            caseSensitive: false,
            conditionType: 'include',
            expected: true
        },
        {
            name: 'AND逻辑 - 部分匹配',
            keywords: [
                {keyword: 'test', logic: 'and'},
                {keyword: 'hello', logic: 'and'}
            ],
            text: 'This is a test message',
            caseSensitive: false,
            conditionType: 'include',
            expected: false
        },
        {
            name: '复杂逻辑 - (A AND B) OR C',
            keywords: [
                {keyword: 'hello', logic: 'and'},
                {keyword: 'world', logic: 'or'},
                {keyword: 'test', logic: 'or'}
            ],
            text: 'This is a test message',
            caseSensitive: false,
            conditionType: 'include',
            expected: true
        },
        {
            name: '复杂逻辑 - (A AND B) OR (C AND D)',
            keywords: [
                {keyword: 'hello', logic: 'and'},
                {keyword: 'world', logic: 'or'},
                {keyword: 'test', logic: 'and'},
                {keyword: 'message', logic: 'or'}
            ],
            text: 'This is a test message',
            caseSensitive: false,
            conditionType: 'include',
            expected: true
        },
        {
            name: '区分大小写 - 匹配',
            keywords: [{keyword: 'Test', logic: 'or'}],
            text: 'This is a Test message',
            caseSensitive: true,
            conditionType: 'include',
            expected: true
        },
        {
            name: '区分大小写 - 不匹配',
            keywords: [{keyword: 'Test', logic: 'or'}],
            text: 'This is a test message',
            caseSensitive: true,
            conditionType: 'include',
            expected: false
        },
        {
            name: '排除条件 - 不包含',
            keywords: [{keyword: 'hello', logic: 'or'}],
            text: 'This is a test message',
            caseSensitive: false,
            conditionType: 'exclude',
            expected: true
        },
        {
            name: '排除条件 - 包含',
            keywords: [{keyword: 'test', logic: 'or'}],
            text: 'This is a test message',
            caseSensitive: false,
            conditionType: 'exclude',
            expected: false
        }
    ];
    
    let passedTests = 0;
    let totalTests = testCases.length;
    
    testCases.forEach((testCase, index) => {
        const result = evaluateKeywordCondition(
            testCase.keywords,
            testCase.text,
            testCase.caseSensitive,
            testCase.conditionType
        );
        
        const passed = result === testCase.expected;
        if (passed) {
            passedTests++;
        }
        
        console.log(`测试 ${index + 1}: ${testCase.name} - ${passed ? '✅ 通过' : '❌ 失败'}`);
        if (!passed) {
            console.log(`  期望: ${testCase.expected}, 实际: ${result}`);
            console.log(`  关键字: ${JSON.stringify(testCase.keywords)}`);
            console.log(`  文本: "${testCase.text}"`);
        }
    });
    
    console.log(`=== 测试完成: ${passedTests}/${totalTests} 通过 ===`);
    
    if (passedTests === totalTests) {
        console.log('🎉 所有测试都通过了！');
    } else {
        console.log('⚠️ 有测试失败，请检查实现');
    }
}

// 在扩展启动时运行测试（仅在开发模式下）
if (chrome.runtime.getManifest().version.includes('dev') || true) {
    // 延迟执行测试，确保所有函数都已加载
    setTimeout(testKeywordEngine, 1000);
}