// background.js - Chrome Extension Service Worker

importScripts('gemini_api.js'); // Import the Gemini API script

let userRules = []; // 存储用户定义的规则
const BATCH_SIZE = 50; // Batch size for manual operations

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

// 监听存储变化，自动重新加载规则
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.aliMailRules) {
        console.log('[Background]: aliMailRules have changed in storage. Reloading rules...');
        loadRules();
    }
});

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
 * @param {Object | Array<Object>} conditionOrConditions - Condition group object or array of condition group objects.
 * @param {Object | Array<Object>} addressContent - The address content to check.
 * @param {boolean} isRecipientList - Indicates if addressContent is an array of recipient objects.
 * @returns {boolean} True if conditions are met, false otherwise.
 */
function checkAddressCondition(conditionOrConditions, addressContent, isRecipientList = false) {
    if (!conditionOrConditions) {
        return true; // No conditions, default pass
    }

    // Handle backward compatibility for a single condition object (legacy rules)
    if (!Array.isArray(conditionOrConditions)) {
        // Assuming old structure: { enabled, type, address, caseSensitive }
        const legacyCondition = conditionOrConditions;
        if (!legacyCondition.enabled || !addressContent) {
            return true; // Condition not enabled or no content, default pass
        }
        const ruleAddress = legacyCondition.caseSensitive ? legacyCondition.address : legacyCondition.address.toLowerCase();
        let matchFound = false;
        if (isRecipientList) {
            if (!Array.isArray(addressContent)) return false;
            for (const recipientObj of addressContent) {
                const email = recipientObj.email || '';
                const displayName = recipientObj.displayName || '';
                const emailToMatch = legacyCondition.caseSensitive ? email : email.toLowerCase();
                const displayNameToMatch = legacyCondition.caseSensitive ? displayName : displayName.toLowerCase();
                if (emailToMatch.includes(ruleAddress) || displayNameToMatch.includes(ruleAddress)) {
                    matchFound = true;
                    break;
                }
            }
        } else {
            if (typeof addressContent !== 'object' || addressContent === null) return false;
            const email = addressContent.email || '';
            const displayName = addressContent.displayName || '';
            const emailToMatch = legacyCondition.caseSensitive ? email : email.toLowerCase();
            const displayNameToMatch = legacyCondition.caseSensitive ? displayName : displayName.toLowerCase();
            if (emailToMatch.includes(ruleAddress) || displayNameToMatch.includes(ruleAddress)) {
                matchFound = true;
            }
        }
        return legacyCondition.type === 'include' ? matchFound : !matchFound;
    }

    // New structure: array of condition groups
    const conditionGroups = conditionOrConditions;
    if (conditionGroups.length === 0) {
        return true; // No groups, default pass
    }

    const enabledGroups = conditionGroups.filter(group => group.enabled);
    if (enabledGroups.length === 0) {
        return true; // No enabled groups, default pass
    }

    for (const group of enabledGroups) {
        if (!addressContent) return true; // Or false, depending on desired strictness for missing content with active groups. Let's keep true for now.

        const ruleAddress = group.caseSensitive ? group.address : group.address.toLowerCase();
        let groupMatchFound = false;

        if (isRecipientList) {
            if (!Array.isArray(addressContent)) {
                console.warn("[checkAddressCondition] Expected recipient list (array) but got:", addressContent);
                // If one group requires recipients and they are not there, this specific group cannot match.
                // However, the overall logic might be OR between groups, so we can't fail the whole checkAddressCondition yet.
                // This means the current group doesn't match.
                groupMatchFound = false;
            } else {
                for (const recipientObj of addressContent) {
                    const email = recipientObj.email || '';
                    const displayName = recipientObj.displayName || '';
                    const emailToMatch = group.caseSensitive ? email : email.toLowerCase();
                    const displayNameToMatch = group.caseSensitive ? displayName : displayName.toLowerCase();
                    if (emailToMatch.includes(ruleAddress) || displayNameToMatch.includes(ruleAddress)) {
                        groupMatchFound = true;
                        break;
                    }
                }
            }
        } else { // Sender (single object)
            if (typeof addressContent !== 'object' || addressContent === null) {
                console.warn("[checkAddressCondition] Expected sender object but got:", addressContent);
                groupMatchFound = false; // Similar to above, this group doesn't match.
            } else {
                const email = addressContent.email || '';
                const displayName = addressContent.displayName || '';
                const emailToMatch = group.caseSensitive ? email : email.toLowerCase();
                const displayNameToMatch = group.caseSensitive ? displayName : displayName.toLowerCase();
                if (emailToMatch.includes(ruleAddress) || displayNameToMatch.includes(ruleAddress)) {
                    groupMatchFound = true;
                }
            }
        }
        
        // Evaluate this group's result based on its type (include/exclude)
        const groupResult = (group.type === 'include') ? groupMatchFound : !groupMatchFound;

        if (!groupResult) {
            // For address conditions, it's usually an AND logic between different *types* of conditions (sender AND recipient)
            // but within a single type (e.g. multiple sender groups), it should be OR.
            // The current structure implies that if any group within this specific condition type (e.g. sender)
            // evaluates to false, the entire checkAddressCondition for this type fails.
            // This might need refinement if OR logic between groups of the same type is desired.
            // For now, let's assume an implicit AND logic for multiple groups of the same address type.
            // This means if one group fails, the whole condition fails.
            // This interpretation might be wrong for "any of these senders" vs "all of these sender conditions".
            // Re-evaluating: The prompt implies "If any enabled group's condition is not met, the function should immediately return false."
            // This suggests an AND logic: all groups must be true.
            return false; // If one group's condition is not met, the overall check fails.
        }
    }
    return true; // All enabled groups' conditions were met.
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
 * @param {Object | Array<Object>} conditionOrConditions - Condition group object or array of condition group objects.
 * @param {string} content - The content to check (subject or body).
 * @returns {boolean} True if conditions are met, false otherwise.
 */
function checkCondition(conditionOrConditions, content) {
    if (!conditionOrConditions) {
        return true; // No conditions, default pass
    }

    // Handle backward compatibility for a single condition object (legacy rules)
    if (!Array.isArray(conditionOrConditions)) {
        const legacyCondition = conditionOrConditions;
        if (!legacyCondition.enabled || (legacyCondition.hasOwnProperty('keywords') && (!legacyCondition.keywords || legacyCondition.keywords.length === 0)) && !content) {
             // If not enabled, or no keywords AND no content, it's a pass (or no-op)
            return true;
        }
        if (!content && legacyCondition.enabled && legacyCondition.keywords && legacyCondition.keywords.length > 0) {
            return false; // Has keywords, is enabled, but no content to check against
        }
        if (!content) return true; // No content, but also no relevant keywords to fail against

        return evaluateKeywordCondition(
            legacyCondition.keywords,
            content,
            legacyCondition.caseSensitive || false,
            legacyCondition.type || 'include'
        );
    }
    
    // New structure: array of condition groups
    const conditionGroups = conditionOrConditions;
    if (conditionGroups.length === 0) {
        return true; // No groups, default pass
    }

    const enabledGroups = conditionGroups.filter(group => group.enabled);
    if (enabledGroups.length === 0) {
        return true; // No enabled groups, default pass
    }

    if (!content) { // If there's no content to check against, but there are enabled groups with keywords
        for (const group of enabledGroups) {
            if (group.keywords && group.keywords.length > 0) {
                // This group wants to check keywords, but there's no content.
                // If it's an 'include' type, it fails. If 'exclude', it passes.
                if (group.type === 'include') return false;
            }
        }
        return true; // All groups were 'exclude' or had no keywords
    }

    for (const group of enabledGroups) {
        const groupResult = evaluateKeywordCondition(
            group.keywords,
            content,
            group.caseSensitive || false,
            group.type || 'include'
        );
        if (!groupResult) {
            // "If evaluateKeywordCondition returns false for any enabled group, checkCondition should immediately return false."
            // This implies an AND logic between groups: all groups must be true.
            return false;
        }
    }
    return true; // All enabled groups' keyword conditions were met.
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
    
    // Load LLM API config once before processing rules
    let activeLlmConfig = null;
    try {
        const storageResult = await chrome.storage.local.get('llmApiConfigs');
        if (storageResult.llmApiConfigs && storageResult.llmApiConfigs.preferredProvider) {
            const preferredProvider = storageResult.llmApiConfigs.preferredProvider;
            if (storageResult.llmApiConfigs.providers && 
                storageResult.llmApiConfigs.providers[preferredProvider] && 
                storageResult.llmApiConfigs.providers[preferredProvider].apiKey) {
                
                activeLlmConfig = {
                    provider: preferredProvider,
                    apiKey: storageResult.llmApiConfigs.providers[preferredProvider].apiKey,
                    model: storageResult.llmApiConfigs.providers[preferredProvider].model
                };
                console.log(`[Background]: Active LLM Config loaded for provider '${preferredProvider}':`, activeLlmConfig.model);
            } else {
                console.warn(`[Background]: LLM config for preferred provider '${preferredProvider}' not found or API key missing. AI rules will be skipped.`);
            }
        } else {
            console.warn('[Background]: LLM API Config not found or preferred provider not set. AI rules will be skipped.');
        }
    } catch (error) {
        console.error('[Background]: Error loading LLM API Config:', error);
    }

    for (const rule of userRules) {
        if (!rule.enabled) {
            console.log(`[Background]: 跳过未启用的规则 "${rule.name}"`);
            continue; // 跳过未启用的规则
        }

        console.log(`[Background]: 检查规则 "${rule.name}" for mail ID ${currentMailId}...`);
        console.log(`[Background]: 规则详情:`, JSON.stringify(rule, null, 2));

        let conditionMet = false; // Initialize to false, explicitly set to true if conditions pass

        const ruleConditionMode = rule.conditionMode || 'normal';

        if (ruleConditionMode === 'ai') {
            if (activeLlmConfig && activeLlmConfig.provider === 'google' && rule.aiPrompt && rule.aiPrompt.user) { // Currently only supporting google
                console.log(`[Background]: Rule "${rule.name}" is an AI rule. Evaluating with ${activeLlmConfig.provider}...`);
                // Ensure we have subject and body. For AI rules, body is almost always essential.
                // Fetch if necessary (similar to existing logic but perhaps more stringent for AI rules)
                if (!currentBodyContent || !currentSubject) { // AI usually needs both
                    console.log(`[Background]: AI Rule "${rule.name}" needs subject/body. Fetching full mail details for ${currentMailId}`);
                    try {
                        const mailDetails = await chrome.tabs.sendMessage(tabId, {
                            action: "fetchMailBody",
                            mailId: currentMailId
                        });
                        if (mailDetails && mailDetails.success && mailDetails.data) {
                            const fullApiData = mailDetails.data.data;
                            currentBodyContent = currentBodyContent || fullApiData.body || '';
                            currentSubject = currentSubject || fullApiData.subject || fullApiData.encSubject || '';
                            // Update sender, recipient, cc as well if they were missing and are now available
                            if ((!currentSender || typeof currentSender.email === 'undefined') && fullApiData.from) {
                                if (typeof fullApiData.from === 'object') {
                                   currentSender = { displayName: fullApiData.from.displayName || '', email: fullApiData.from.email || '' };
                                } else if (typeof fullApiData.from === 'string') { currentSender = { displayName: fullApiData.from, email: '' };}
                            }
                            if (!currentRecipient && fullApiData.to && fullApiData.to.length > 0) { currentRecipient = fullApiData.to.map(r => ({ displayName: r.name, email: r.address })); }
                            if (!currentCcRecipients && fullApiData.cc && fullApiData.cc.length > 0) { currentCcRecipients = fullApiData.cc.map(r => ({ displayName: r.name, email: r.address })); }

                            console.log(`[Background]: Mail details fetched for AI rule. Subject: "${currentSubject}", Body length: ${currentBodyContent.length}`);
                        } else {
                            console.error(`[Background]: Failed to fetch mail body for AI rule "${rule.name}". Skipping AI check.`);
                            conditionMet = false; // Cannot proceed with AI check
                            // continue; // Skip to next rule - or let it fall through to conditionMet = false check
                        }
                    } catch (fetchError) {
                        console.error(`[Background]: Error fetching mail body for AI rule "${rule.name}":`, fetchError);
                        conditionMet = false;
                        // continue;
                    }
                }
                
                // Proceed only if we have the necessary content after potential fetch
                if (currentSubject && currentBodyContent) { // Check both, as AI prompt relies on them
                    conditionMet = await checkEmailWithGemini(
                        activeLlmConfig.apiKey,
                        activeLlmConfig.model,
                        rule.aiPrompt.system, // System prompt from the rule itself (captured at rule save time)
                        rule.aiPrompt.user,
                        currentSubject, 
                        currentBodyContent 
                    );
                    console.log(`[Background]: AI Rule "${rule.name}" evaluation result: ${conditionMet}`);
                } else {
                    console.warn(`[Background]: AI Rule "${rule.name}" skipped. Missing subject or body content even after potential fetch.`);
                    conditionMet = false;
                }

            } else {
                console.warn(`[Background]: Skipping AI rule "${rule.name}" due to missing or non-Google LLM configuration, or missing prompt.`);
                conditionMet = false;
            }
        } else { // 'normal' condition mode
            conditionMet = true; // Assume true, and let each check AND with it.

            // Helper to determine if a condition type (like 'body', 'recipient') is active and requires data
            const isConditionTypeActive = (conditionTypeArray) => {
                return Array.isArray(conditionTypeArray) && conditionTypeArray.some(group => group.enabled);
            };

            const requiresBody = isConditionTypeActive(rule.conditions.body);
            const requiresRecipient = isConditionTypeActive(rule.conditions.recipient);
            const requiresCc = isConditionTypeActive(rule.conditions.cc);
            const requiresSender = isConditionTypeActive(rule.conditions.sender); // Though sender is usually available early
            const requiresSubject = isConditionTypeActive(rule.conditions.subject); // Subject also usually available

            // 检查发件人条件
            if (requiresSender) {
                if (!currentSender) {
                    console.warn(`[Background]: Sender info missing for rule "${rule.name}", sender condition might fail if not fetched.`);
                    // Attempt to fetch full details if sender is missing and rule depends on it
                }
                // Pass the whole array of sender condition groups
                const senderMatch = checkAddressCondition(rule.conditions.sender, currentSender, false);
                console.log(`[Background]: Sender condition match result: ${senderMatch} for rule "${rule.name}"`);
                conditionMet = conditionMet && senderMatch;
            }
            
            // 检查收件人条件
            if (conditionMet && requiresRecipient) {
                if (!currentRecipient) {
                     console.log(`[Background]: Rule "${rule.name}" needs recipient info, currently missing.`);
                }
                const recipientMatch = checkAddressCondition(rule.conditions.recipient, currentRecipient, true);
                console.log(`[Background]: Recipient condition match result: ${recipientMatch} for rule "${rule.name}"`);
                conditionMet = conditionMet && recipientMatch;
            }

            // 检查抄送条件
            if (conditionMet && requiresCc) {
                if (!currentCcRecipients) {
                     console.log(`[Background]: Rule "${rule.name}" needs CC info, currently missing.`);
                }
                const ccMatch = checkAddressCondition(rule.conditions.cc, currentCcRecipients, true);
                console.log(`[Background]: CC condition match result: ${ccMatch} for rule "${rule.name}"`);
                conditionMet = conditionMet && ccMatch;
            }

            // 检查主题条件
            if (conditionMet && requiresSubject) {
                const subjectMatch = checkCondition(rule.conditions.subject, currentSubject);
                console.log(`[Background]: Subject condition match result: ${subjectMatch} for rule "${rule.name}"`);
                conditionMet = conditionMet && subjectMatch;
            }

            if (!conditionMet) {
                console.log(`[Background]: Rule "${rule.name}" did not match based on initial header/available info for mail ${currentMailId}`);
                continue; // Skip to next rule
            }

            // Determine if a fetch for more data is needed
            const needsBodyFetch = requiresBody && !currentBodyContent;
            const needsRecipientFetch = requiresRecipient && !currentRecipient;
            const needsCcFetch = requiresCc && !currentCcRecipients;
            // Sender fetch might be considered if currentSender is null and requiresSender is true
            const needsSenderFetch = requiresSender && !currentSender;

            const needsFurtherDataFetch = needsBodyFetch || needsRecipientFetch || needsCcFetch || needsSenderFetch;

            if (needsFurtherDataFetch) {
                console.log(`[Background]: Rule "${rule.name}" requires further data (body/recipient/cc/sender). Fetching for ${currentMailId}`);
                try {
                    const mailDetails = await chrome.tabs.sendMessage(tabId, {
                        action: "fetchMailBody",
                        mailId: currentMailId
                    });

                    if (mailDetails && mailDetails.success && mailDetails.data) {
                        const fullApiData = mailDetails.data.data;
                        // Update available content
                        currentBodyContent = currentBodyContent || fullApiData.body || ''; // Keep existing if already fetched
                        if ((!currentSender || typeof currentSender.email === 'undefined') && fullApiData.from) { // Update if not set or incomplete
                           if (typeof fullApiData.from === 'object') {
                              currentSender = { displayName: fullApiData.from.displayName || '', email: fullApiData.from.email || '' };
                           } else if (typeof fullApiData.from === 'string') { currentSender = { displayName: fullApiData.from, email: '' };}
                        }
                        if (!currentRecipient && mailDetails.recipient) { // mailDetails.recipient IS the array from content script
                            currentRecipient = mailDetails.recipient; 
                        }
                        if (!currentCcRecipients && mailDetails.ccRecipients) {
                            currentCcRecipients = mailDetails.ccRecipients;
                        }
                        console.log(`[Background]: Full mail details fetched for ${currentMailId}. Body length: ${currentBodyContent?.length}`);

                        // Re-evaluate conditions that might have depended on fetched data
                        // AND with existing conditionMet. If it was already false, it stays false.
                        if (conditionMet && needsSenderFetch && requiresSender) {
                            const senderMatch = checkAddressCondition(rule.conditions.sender, currentSender, false);
                            console.log(`[Background]: Sender condition re-evaluation after fetch: ${senderMatch}`);
                            conditionMet = conditionMet && senderMatch;
                        }
                        if (conditionMet && needsRecipientFetch && requiresRecipient) {
                            const recipientMatch = checkAddressCondition(rule.conditions.recipient, currentRecipient, true);
                            console.log(`[Background]: Recipient condition re-evaluation after fetch: ${recipientMatch}`);
                            conditionMet = conditionMet && recipientMatch;
                        }
                        if (conditionMet && needsCcFetch && requiresCc) {
                            const ccMatch = checkAddressCondition(rule.conditions.cc, currentCcRecipients, true);
                            console.log(`[Background]: CC condition re-evaluation after fetch: ${ccMatch}`);
                            conditionMet = conditionMet && ccMatch;
                        }
                        // Body condition is checked separately after this block if still needed
                    } else {
                        console.error(`[Background]: Failed to fetch full mail details for ${currentMailId}. Rule "${rule.name}" may not match if dependent on this data.`);
                        // If critical data is still missing, set conditionMet to false
                        if (needsBodyFetch && !currentBodyContent && requiresBody) conditionMet = false;
                        if (needsRecipientFetch && !currentRecipient && requiresRecipient) conditionMet = false;
                        if (needsCcFetch && !currentCcRecipients && requiresCc) conditionMet = false;
                        if (needsSenderFetch && !currentSender && requiresSender) conditionMet = false;
                    }
                } catch (error) {
                    console.error(`[Background]: Error fetching mail details for ${currentMailId}:`, error);
                    if (needsBodyFetch && !currentBodyContent && requiresBody) conditionMet = false;
                    if (needsRecipientFetch && !currentRecipient && requiresRecipient) conditionMet = false;
                    if (needsCcFetch && !currentCcRecipients && requiresCc) conditionMet = false;
                    if (needsSenderFetch && !currentSender && requiresSender) conditionMet = false;
                }
            } // End of needsFurtherDataFetch block

            // If, after potential fetch, conditions are still not met, skip this rule.
            if (!conditionMet) {
                console.log(`[Background]: Rule "${rule.name}" (mode: ${ruleConditionMode}) did not match after data fetch for mail ${currentMailId}`);
                continue;
            }

            // Check body condition ONLY if it's required AND conditionMet is still true
            if (conditionMet && ruleConditionMode === 'normal' && requiresBody) {
                if (!currentBodyContent) {
                     console.warn(`[Background]: Rule "${rule.name}" requires body content, but it's unavailable. Rule will not match.`);
                     conditionMet = false;
                } else {
                    const bodyMatch = checkCondition(rule.conditions.body, currentBodyContent);
                    console.log(`[Background]: Body condition match result: ${bodyMatch} for rule "${rule.name}"`);
                    conditionMet = conditionMet && bodyMatch;
                }
            }
        } // End of 'normal' condition mode block
        
        // Final check of conditionMet before executing actions
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
                mailIds: [currentMailIdForActions],
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
                mailIds: [currentMailIdForActions],
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
 * 新：确定邮件应执行的操作，但不实际执行。
 *供 manualExecuteRules 使用。
 * @param {Object} mailDetails 包含邮件所有相关信息的对象 (mailId, subject, body, sender, recipient, ccRecipients)
 * @param {Array} rulesToApply 要应用的用户规则列表
 * @param {Object} tagMap 当前标签名称到ID的映射
 * @param {Object} folderMap 当前文件夹名称到ID的映射
 * @returns {Array} 一系列操作对象，例如 [{ type: 'markRead', mailId: '...', isRead: true }, ...]
 */
function determineActionsForMail(mailDetails, rulesToApply, tagMap, folderMap) {
    const determinedActions = [];
    const { mailId, subject, body, sender, recipient, ccRecipients } = mailDetails;

    for (const rule of rulesToApply) {
        if (!rule.enabled) {
            continue;
        }

        let conditionMet = true;

        // 检查发件人条件
        if (rule.conditions?.sender?.enabled) {
            if (!sender) { conditionMet = false; }
            else { conditionMet = conditionMet && checkAddressCondition(rule.conditions.sender, sender, false); }
        }
        // 检查收件人条件
        if (conditionMet && rule.conditions?.recipient?.enabled) {
            if (!recipient) { conditionMet = false; }
            else { conditionMet = conditionMet && checkAddressCondition(rule.conditions.recipient, recipient, true); }
        }
        // 检查抄送条件
        if (conditionMet && rule.conditions?.cc?.enabled) {
            if (!ccRecipients) { conditionMet = false; }
            else { conditionMet = conditionMet && checkAddressCondition(rule.conditions.cc, ccRecipients, true); }
        }
        // 检查主题条件
        if (conditionMet && rule.conditions?.subject?.enabled) {
            conditionMet = conditionMet && checkCondition(rule.conditions.subject, subject);
        }
        // 检查正文条件
        if (conditionMet && rule.conditions?.body?.enabled) {
            if (!body) { conditionMet = false; } // Body must exist if condition enabled
            else { conditionMet = conditionMet && checkCondition(rule.conditions.body, body); }
        }

        if (conditionMet) {
            console.log(`[Background] (Determine): Rule "${rule.name}" matched mail ${mailId}.`);
            // 从规则中提取操作
            if (rule.action) {
                if (rule.action.markAsRead) {
                    determinedActions.push({ type: 'markRead', mailId: mailId, isRead: true });
                }
                if (rule.action.setLabel) {
                    const labelsToSet = Array.isArray(rule.action.setLabel) ? rule.action.setLabel : [rule.action.setLabel];
                    const tagIds = [];
                    labelsToSet.forEach(labelName => {
                        if (tagMap[labelName]) {
                            tagIds.push(tagMap[labelName]);
                        } else {
                            console.warn(`[Background] (Determine): Label "${labelName}" not found in tagMap.`);
                        }
                    });
                    if (tagIds.length > 0) {
                        determinedActions.push({ type: 'applyLabel', mailId: mailId, tagIds: tagIds });
                    }
                }
                if (rule.action.moveToFolder && folderMap[rule.action.moveToFolder]) {
                    const folderId = folderMap[rule.action.moveToFolder];
                    determinedActions.push({
                        type: 'moveMail',
                        mailId: mailId,
                        folderId: folderId,
                        originalUniqueId: extractUniqueId(mailId) // Needed for verification
                    });
                }
                // 注意: 此函数不处理mailId的更改。所有操作都基于初始mailId。
                // 后续操作，如"标记为已读"，将引用原始mailId。
            }

            if (rule.action && rule.action.stopProcessing) {
                console.log(`[Background] (Determine): Rule "${rule.name}" includes "stopProcessing".`);
                break; // 停止处理此邮件的更多规则
            }
        }
    }
    return determinedActions;
}

/**
 * 手动执行规则 - 遍历收件箱未读邮件并应用规则
 * @param {number} tabId 阿里邮箱页面的Tab ID
 * @param {string[] | undefined} selectedRuleIds 可选的，要执行的特定规则ID数组
 * @returns {Promise<Object>} 执行结果
 */
async function manualExecuteRules(tabId, selectedRuleIds) {
    console.log(`[Background]: 开始手动执行规则，Tab ID: ${tabId}`);
    if (selectedRuleIds && selectedRuleIds.length > 0) {
        console.log(`[Background]: 将只执行选定的规则: ${selectedRuleIds.join(', ')}`);
    }
    
    const actionsTakenCounts = { markedRead: 0, labeled: 0, moved: 0 };
    let processedMailCount = 0;
    let mailHeadersToProcess = [];
    let totalMailInScopeCount = 0; // Total mails matching initial query

    const MAIL_PROCESS_LIMIT = 1000; // Max mails to fetch headers for in one go
    // BATCH_SIZE is already defined globally (e.g., 50) for API calls

    try {
        // 0. 加载最新规则和映射
        await loadRules();
        const storageData = await chrome.storage.local.get(['aliMailTags', 'aliMailFolders']);
        const currentTags = storageData.aliMailTags || {};
        const currentFolders = storageData.aliMailFolders || {};

        let rulesToApply = userRules.filter(rule => rule.enabled); // Default to all enabled rules
        if (selectedRuleIds && selectedRuleIds.length > 0) {
            const selectedEnabledRules = userRules.filter(rule => selectedRuleIds.includes(rule.id) && rule.enabled);
            if (selectedEnabledRules.length === 0) {
                 console.log(`[Background]: 选择的规则均未找到或未启用，未处理任何邮件。`);
                 return {
                    success: true,
                    processedMailCount: 0,
                    totalUnreadCount: 0, // Compatibility with old response structure
                    totalMailCountInScope: 0,
                    actionsTakenCounts: actionsTakenCounts,
                    message: "选择的规则均未找到或未启用，未处理任何邮件。"
                };
            }
            rulesToApply = selectedEnabledRules;
        }
        console.log(`[Background]: 将处理 ${rulesToApply.length} 条规则.`);
        if (rulesToApply.length === 0) {
            return { 
                success: true, 
                processedMailCount: 0,
                totalUnreadCount: 0, // Compatibility
                totalMailCountInScope: 0,
                actionsTakenCounts: actionsTakenCounts,
                message: "没有启用的规则可供执行。"
            };
        }

        // 1. 获取邮件列表 (仅头部信息) - target inbox "2"
        const mailListResponse = await chrome.tabs.sendMessage(tabId, {
            action: "queryMailList",
            folderIds: ["2"], 
            maxLength: MAIL_PROCESS_LIMIT,
            offset: 0
        });

        if (!mailListResponse || !mailListResponse.success) {
            return { 
                success: false, 
                error: mailListResponse?.error || "获取邮件列表失败 (queryMailList)" 
            };
        }

        mailHeadersToProcess = mailListResponse.mails || [];
        totalMailInScopeCount = mailListResponse.totalCount || mailHeadersToProcess.length;
        console.log(`[Background]: 获取到 ${mailHeadersToProcess.length} 封邮件头进行处理，总计 (API报告): ${totalMailInScopeCount}`);

        if (mailHeadersToProcess.length === 0) {
            return {
                success: true,
                processedMailCount: 0,
                totalUnreadCount: totalMailInScopeCount, // For popup.js compatibility
                totalMailCountInScope: totalMailInScopeCount,
                actionsTakenCounts: actionsTakenCounts,
                message: "收件箱没有邮件可供处理。"
            };
        }

        // 2. 分批处理邮件头
        for (let i = 0; i < mailHeadersToProcess.length; i += BATCH_SIZE) {
            const currentChunkMailHeaders = mailHeadersToProcess.slice(i, i + BATCH_SIZE);
            console.log(`[Background]: 处理邮件批次 ${Math.floor(i / BATCH_SIZE) + 1}, 包含 ${currentChunkMailHeaders.length} 封邮件.`);

            const collectedBatchActions = {
                markReadMailIds: new Set(),
                labelsToApply: {}, // key: sortedTagIdsStr, value: { tagIds: [], mailIds: new Set() }
                movesToPerform: [] // { mailId: '...', folderId: '...', originalUniqueId: '...' }
            };

            for (const mailHeader of currentChunkMailHeaders) {
                console.log(`[Background]: 手动执行 - 开始处理邮件 ${mailHeader.mailId}`);
                processedMailCount++;
                // Initial details from header
                let currentMailDetails = {
                    mailId: mailHeader.mailId,
                    subject: mailHeader.subject || mailHeader.encSubject || '',
                    sender: null, // Will be parsed or fetched
                    body: null,
                    recipient: null,
                    ccRecipients: null
                };
                
                // Parse initial sender from mailHeader.from
                if (mailHeader.from) {
                     if (typeof mailHeader.from === 'object') {
                        currentMailDetails.sender = { 
                            displayName: mailHeader.from.displayName || '', 
                            email: mailHeader.from.email || '' 
                        };
                    } else if (typeof mailHeader.from === 'string') {
                        const match = mailHeader.from.match(/(.*)<(.*)>/);
                        if (match && match[1] && match[2]) {
                            currentMailDetails.sender = { displayName: match[1].trim(), email: match[2].trim() };
                        } else {
                            currentMailDetails.sender = { displayName: mailHeader.from, email: '' };
                        }
                    }
                }
                
                const actionsForCurrentEmail = await determineActionsForSingleMailManual(
                    currentMailDetails, // Pass an object that can be augmented
                    rulesToApply,
                    tabId,
                    currentTags,
                    currentFolders
                );

                actionsForCurrentEmail.forEach(action => {
                    if (action.type === 'markRead') {
                        collectedBatchActions.markReadMailIds.add(action.mailId);
                    } else if (action.type === 'applyLabel') {
                        const sortedTagIdsKey = action.tagIds.slice().sort().join(',');
                        if (!collectedBatchActions.labelsToApply[sortedTagIdsKey]) {
                            collectedBatchActions.labelsToApply[sortedTagIdsKey] = {
                                tagIds: action.tagIds,
                                mailIds: new Set()
                            };
                        }
                        collectedBatchActions.labelsToApply[sortedTagIdsKey].mailIds.add(action.mailId);
                    } else if (action.type === 'moveMail') {
                        // Ensure each move action is distinct even if multiple rules move to same folder
                        // (though stopProcessing should typically prevent this for a single mail)
                        collectedBatchActions.movesToPerform.push({ 
                            mailId: action.mailId, 
                            folderId: action.folderId, 
                            originalUniqueId: extractUniqueId(action.mailId)
                        });
                    }
                });
            } // End for each mailHeader in chunk

            // 3. 执行当前批次的收集操作
            console.log('[Background]: 开始执行当前批次的批量操作...', collectedBatchActions);

            // 3.1 应用标签 (Before move, as mailId doesn't change)
            for (const key in collectedBatchActions.labelsToApply) {
                const op = collectedBatchActions.labelsToApply[key];
                const mailIdsArray = Array.from(op.mailIds);
                if (mailIdsArray.length > 0) {
                    console.log(`[Background]: (批量) 应用标签 ${op.tagIds.join(',')} 到 ${mailIdsArray.length} 封邮件.`);
                    try {
                        const response = await chrome.tabs.sendMessage(tabId, {
                            action: "applyLabel",
                            mailIds: mailIdsArray,
                            tagIds: op.tagIds
                        });
                        if (response && response.success) actionsTakenCounts.labeled += mailIdsArray.length;
                        else console.warn("[Background]: 批量应用标签失败", response);
                    } catch (e) { console.error("[Background]: 批量应用标签API调用出错", e); }
                }
            }
            
            // 3.2 标记为已读 (Before move)
            const markReadIdsArray = Array.from(collectedBatchActions.markReadMailIds);
            if (markReadIdsArray.length > 0) {
                console.log(`[Background]: (批量) 标记 ${markReadIdsArray.length} 封邮件为已读.`);
                try {
                    const response = await chrome.tabs.sendMessage(tabId, {
                        action: "markRead",
                        mailIds: markReadIdsArray,
                        isRead: true
                    });
                    if (response && response.success) actionsTakenCounts.markedRead += markReadIdsArray.length;
                    else console.warn("[Background]: 批量标记已读失败", response);
                } catch (e) { console.error("[Background]: 批量标记已读API调用出错", e); }
            }

            // 3.3 执行移动 (逐个执行以进行验证, after other ops as mailId might change)
            // Filter moves to ensure we only move a mailId once if multiple rules tried to move it (stopProcessing should prevent this mostly)
            const uniqueMoves = [];
            const movedMailIdsInBatch = new Set();
            for (const moveAction of collectedBatchActions.movesToPerform) {
                if (!movedMailIdsInBatch.has(moveAction.mailId)) {
                    uniqueMoves.push(moveAction);
                    movedMailIdsInBatch.add(moveAction.mailId);
                }
            }

            for (const moveAction of uniqueMoves) {
                console.log(`[Background]: (批量) 移动邮件 ${moveAction.mailId} 到文件夹 ${moveAction.folderId}`);
                try {
                    const moveResponse = await chrome.tabs.sendMessage(tabId, {
                        action: "moveMail",
                        mailIds: [moveAction.mailId],
                        folderId: moveAction.folderId
                    });
                    if (moveResponse && moveResponse.success) {
                        const verifyResponse = await chrome.tabs.sendMessage(tabId, {
                            action: "verifyMailMove",
                            originalUniqueId: moveAction.originalUniqueId,
                            targetFolderId: moveAction.folderId,
                            maxResults: 5 
                        });
                        if (verifyResponse && verifyResponse.success && verifyResponse.found) {
                            actionsTakenCounts.moved++;
                            console.log(`[Background]: 邮件 ${moveAction.mailId} 移动并验证成功 (新ID: ${verifyResponse.newMailId})`);
                        } else {
                            console.warn(`[Background]: 移动邮件 ${moveAction.mailId} 后验证失败.`, verifyResponse);
                        }
                    } else {
                         console.warn(`[Background]: 移动邮件 ${moveAction.mailId} 失败.`, moveResponse);
                    }
                } catch (e) {
                    console.error(`[Background]: 移动邮件 ${moveAction.mailId} API调用出错`, e);
                }
            }
        } // End for each chunk

        console.log('[Background]: 手动规则执行完成。');
        return { 
            success: true, 
            processedMailCount: processedMailCount,
            totalUnreadCount: totalMailInScopeCount, // For popup.js compatibility
            totalMailCountInScope: totalMailInScopeCount,
            actionsTakenCounts: actionsTakenCounts
        };

    } catch (error) {
        console.error("[Background]: 手动执行规则时出错:", error);
        // Ensure error object is serializable for sendResponse
        const errorResponse = { 
            message: error.message, 
            name: error.name, 
            stack: error.stack 
        };
        return { 
            success: false, 
            error: errorResponse,
            processedMailCount: processedMailCount,
            totalUnreadCount: totalMailInScopeCount, // Compatibility
            totalMailCountInScope: totalMailInScopeCount,
            actionsTakenCounts: actionsTakenCounts
        };
    }
}

/**
 * Helper for manualExecuteRules: Determines actions for a single mail item, fetching details on demand.
 * @param {Object} mailDetailsSoFar - Object containing initial mailId, subject, sender. Will be augmented with body, recipient, cc if fetched.
 * @param {Array} rulesToApply - The list of rules to check against this email.
 * @param {number} tabId - The ID of the tab to send messages for fetching.
 * @param {Object} tagMap - Current tag name to ID map.
 * @param {Object} folderMap - Current folder name to ID map.
 * @returns {Promise<Array>} A promise that resolves to an array of action objects.
 */
async function determineActionsForSingleMailManual(mailDetailsSoFar, rulesToApply, tabId, tagMap, folderMap) {
    const determinedActions = [];
    let fetchedFullDetails = false; // Track if we've fetched full details for this mail

    for (const rule of rulesToApply) {
        if (!rule.enabled) continue; // Should have been pre-filtered, but as a safeguard

        console.log(`[Background] (ManualSingle): Checking rule "${rule.name}" for mail ${mailDetailsSoFar.mailId}`);
        let conditionMet = true;
        let requiresFetch = false;

        // Check conditions and determine if a fetch is needed
        if (rule.conditions?.sender?.enabled) {
            if (!mailDetailsSoFar.sender) { // Sender might be missing or sparsely populated from header
                 // Sender is critical and simple, often available in header or first fetch.
                 // If rule needs sender and it's still null, it's an issue.
                 // For now, assume if it's null, it might need a fetch if other conditions also trigger it.
                 // Or, we can decide that if sender is null, sender condition implicitly fails or triggers fetch.
                 // Let's try to fetch if any rich data is needed.
                requiresFetch = true; 
            }
        }
        if (rule.conditions?.recipient?.enabled && !mailDetailsSoFar.recipient) requiresFetch = true;
        if (rule.conditions?.cc?.enabled && !mailDetailsSoFar.ccRecipients) requiresFetch = true;
        if (rule.conditions?.body?.enabled && !mailDetailsSoFar.body) requiresFetch = true;
        
        // Perform fetch if needed and not already done
        if (requiresFetch && !fetchedFullDetails) {
            console.log(`[Background] (ManualSingle): Rule "${rule.name}" requires full details for ${mailDetailsSoFar.mailId}. Fetching...`);
            try {
                const fullDetailsResponse = await chrome.tabs.sendMessage(tabId, {
                    action: "fetchMailBody",
                    mailId: mailDetailsSoFar.mailId
                });

                if (fullDetailsResponse && fullDetailsResponse.success && fullDetailsResponse.data) {
                    const apiData = fullDetailsResponse.data.data; // Actual mail content from loadMail.txt
                    
                    mailDetailsSoFar.subject = mailDetailsSoFar.subject || apiData.subject || apiData.encSubject || ''; // Update if it was empty
                    mailDetailsSoFar.body = apiData.body || apiData.htmlBody || apiData.textBody || ''; // Prefer htmlBody if available
                    
                    // Update sender (more reliable from full fetch)
                    if (apiData.from) {
                        if (typeof apiData.from === 'object') {
                            mailDetailsSoFar.sender = { displayName: apiData.from.displayName || '', email: apiData.from.email || '' };
                        } else if (typeof apiData.from === 'string') {
                             const match = apiData.from.match(/(.*)<(.*)>/);
                             if (match && match[1] && match[2]) {
                                mailDetailsSoFar.sender = { displayName: match[1].trim(), email: match[2].trim() };
                             } else {
                                mailDetailsSoFar.sender = { displayName: apiData.from, email: '' };
                             }
                        }
                    } else if (fullDetailsResponse.sender && !mailDetailsSoFar.sender) { // Fallback to parsed sender by content script
                        mailDetailsSoFar.sender = fullDetailsResponse.sender;
                    }

                    // Update recipients (from parsed fields in fetchMailBody response)
                    mailDetailsSoFar.recipient = fullDetailsResponse.recipient || []; // Expects array
                    mailDetailsSoFar.ccRecipients = fullDetailsResponse.ccRecipients || []; // Expects array
                    
                    fetchedFullDetails = true;
                    console.log(`[Background] (ManualSingle): Full details fetched for ${mailDetailsSoFar.mailId}. Body length: ${mailDetailsSoFar.body?.length}`);
                } else {
                    console.warn(`[Background] (ManualSingle): Failed to fetch full details for ${mailDetailsSoFar.mailId}. Rule "${rule.name}" might not match if it depends on fetched data.`);
                    // If fetch fails, conditions requiring fetched data might implicitly fail.
                }
            } catch (error) {
                console.error(`[Background] (ManualSingle): Error fetching full details for ${mailDetailsSoFar.mailId}:`, error);
            }
        }

        // Now, evaluate all conditions with potentially updated mailDetailsSoFar
        if (rule.conditions?.sender?.enabled) {
            if (!mailDetailsSoFar.sender) { conditionMet = false; }
            else { conditionMet = conditionMet && checkAddressCondition(rule.conditions.sender, mailDetailsSoFar.sender, false); }
        }
        if (conditionMet && rule.conditions?.recipient?.enabled) {
            if (!mailDetailsSoFar.recipient || mailDetailsSoFar.recipient.length === 0) { // Check if array is empty too
                 // If recipient info was required, fetched, but still unavailable/empty, condition fails
                conditionMet = fetchedFullDetails && (!mailDetailsSoFar.recipient || mailDetailsSoFar.recipient.length === 0) ? false : conditionMet;
                if (!fetchedFullDetails && !mailDetailsSoFar.recipient) conditionMet = false; // If not fetched and needed
            } else { 
                conditionMet = conditionMet && checkAddressCondition(rule.conditions.recipient, mailDetailsSoFar.recipient, true); 
            }
        }
        if (conditionMet && rule.conditions?.cc?.enabled) {
            if (!mailDetailsSoFar.ccRecipients || mailDetailsSoFar.ccRecipients.length === 0) {
                conditionMet = fetchedFullDetails && (!mailDetailsSoar.ccRecipients || mailDetailsSoFar.ccRecipients.length === 0) ? false : conditionMet;
                if (!fetchedFullDetails && !mailDetailsSoFar.ccRecipients) conditionMet = false;
            } else { 
                conditionMet = conditionMet && checkAddressCondition(rule.conditions.cc, mailDetailsSoFar.ccRecipients, true); 
            }
        }
        if (conditionMet && rule.conditions?.subject?.enabled) {
            conditionMet = conditionMet && checkCondition(rule.conditions.subject, mailDetailsSoFar.subject);
        }
        if (conditionMet && rule.conditions?.body?.enabled) {
            if (!mailDetailsSoFar.body) { // Body must exist if condition enabled and was fetched or attempted
                conditionMet = false; 
            } else { 
                conditionMet = conditionMet && checkCondition(rule.conditions.body, mailDetailsSoFar.body); 
            }
        }

        if (conditionMet) {
            console.log(`[Background] (ManualSingle): Rule "${rule.name}" matched mail ${mailDetailsSoFar.mailId}.`);
            if (rule.action) {
                if (rule.action.markAsRead) {
                    determinedActions.push({ type: 'markRead', mailId: mailDetailsSoFar.mailId, isRead: true });
                }
                if (rule.action.setLabel) {
                    const labelsToSet = Array.isArray(rule.action.setLabel) ? rule.action.setLabel : [rule.action.setLabel];
                    const tagIds = [];
                    labelsToSet.forEach(labelName => {
                        if (tagMap[labelName]) {
                            tagIds.push(tagMap[labelName]);
                        } else {
                            console.warn(`[Background] (ManualSingle): Label "${labelName}" not found in tagMap.`);
                        }
                    });
                    if (tagIds.length > 0) {
                        determinedActions.push({ type: 'applyLabel', mailId: mailDetailsSoFar.mailId, tagIds: tagIds });
                    }
                }
                if (rule.action.moveToFolder && folderMap[rule.action.moveToFolder]) {
                    const folderId = folderMap[rule.action.moveToFolder];
                    determinedActions.push({
                        type: 'moveMail',
                        mailId: mailDetailsSoFar.mailId,
                        folderId: folderId
                        // originalUniqueId will be added when batching moves
                    });
                }
                // NOTE: 'delete' action type is not handled here yet, but could be added.
            }

            if (rule.action && rule.action.stopProcessing) {
                console.log(`[Background] (ManualSingle): Rule "${rule.name}" includes "stopProcessing" for mail ${mailDetailsSoFar.mailId}.`);
                break; 
            }
        }
    }
    return determinedActions;
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
            // 现在传递 selectedRuleIds (如果存在)
            manualExecuteRules(message.tabId, message.selectedRuleIds).then(sendResponse);
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
