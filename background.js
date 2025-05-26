// background.js - Chrome Extension Service Worker

let userRules = []; // 存储用户定义的规则
let cachedTags = {}; // 缓存标签ID映射
let cachedFolders = {}; // 缓存文件夹ID映射

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
// 规则引擎 (只实现正文关键字匹配和核心操作)
// ===============================================

/**
 * 运行规则引擎对邮件进行匹配和处理
 * @param {string} mailId 邮件的mailId
 * @param {string} bodyContent 邮件的HTML或纯文本正文
 * @param {string} subject 邮件主题
 * @param {number} tabId 邮件所在的Tab ID，用于向Content Script发送消息
 */
async function runRulesEngine(mailId, bodyContent, subject, tabId) {
    console.log(`[Background]: 运行规则引擎处理邮件 ${mailId}...`);
    for (const rule of userRules) {
        if (!rule.enabled) {
            continue; // 跳过未启用的规则
        }

        // --- 匹配条件 (只实现正文关键字) ---
        let conditionMet = true;

        // 检查正文条件
        if (rule.conditions && rule.conditions.body && rule.conditions.body.enabled) {
            const bodyCondition = rule.conditions.body;
            if (bodyCondition.keywords && bodyCondition.keywords.length > 0) {
                let bodyMatch = false;
                const textToMatch = bodyCondition.caseSensitive ? bodyContent : bodyContent.toLowerCase();
                const keywordsToMatch = bodyCondition.caseSensitive ? 
                    bodyCondition.keywords : 
                    bodyCondition.keywords.map(k => k.toLowerCase());

                if (bodyCondition.logic === 'or') {
                    bodyMatch = keywordsToMatch.some(keyword => textToMatch.includes(keyword));
                } else { // 'and'
                    bodyMatch = keywordsToMatch.every(keyword => textToMatch.includes(keyword));
                }

                if (bodyCondition.type === 'include') {
                    conditionMet = bodyMatch;
                } else { // 'exclude'
                    conditionMet = !bodyMatch;
                }
            }
        }
        // ... 其他条件 (发件人、收件人、主题、附件) 可以在这里扩展，目前不实现，默认为真

        if (conditionMet) {
            console.log(`[Background]: 规则 "${rule.name}" 匹配邮件 ${mailId} 成功。执行操作...`);
            // --- 执行操作 (只实现移动、设置标签、标记已读) ---
            
            // 移动到文件夹
            if (rule.action && rule.action.moveToFolder && cachedFolders[rule.action.moveToFolder]) {
                const folderId = cachedFolders[rule.action.moveToFolder];
                try {
                    const response = await chrome.tabs.sendMessage(tabId, {
                        action: "moveMail",
                        mailId: mailId,
                        folderId: folderId
                    });
                    console.log("[Background]: 移动邮件操作结果:", response);
                } catch (error) {
                    console.error("[Background]: 移动邮件操作失败:", error);
                }
            }

            // 设置标签
            if (rule.action && rule.action.setLabel && cachedTags[rule.action.setLabel]) {
                const tagId = cachedTags[rule.action.setLabel];
                try {
                    const response = await chrome.tabs.sendMessage(tabId, {
                        action: "applyLabel",
                        mailId: mailId,
                        tagId: tagId
                    });
                    console.log("[Background]: 设置标签操作结果:", response);
                } catch (error) {
                    console.error("[Background]: 设置标签操作失败:", error);
                }
            }

            // 标记为已读
            if (rule.action && rule.action.markAsRead) {
                try {
                    const response = await chrome.tabs.sendMessage(tabId, {
                        action: "markRead",
                        mailId: mailId,
                        isRead: true
                    });
                    console.log("[Background]: 标记为已读操作结果:", response);
                } catch (error) {
                    console.error("[Background]: 标记为已读操作失败:", error);
                }
            }

            // 如果匹配成功并执行了操作，通常不再运行其他规则
            // 除非规则有明确的"继续处理"选项
            break; 
        }
    }
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
            console.log("[Background]: 当前缓存标签:", cachedTags);
            console.log("[Background]: 当前缓存文件夹:", cachedFolders);
            
            const response = { 
                success: true, 
                tags: cachedTags, 
                folders: cachedFolders 
            };
            
            console.log("[Background]: 发送响应:", response);
            sendResponse(response);
            return;
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
        // 立即向 Content Script 请求邮件正文
        chrome.tabs.sendMessage(sender.tab.id, {
            action: "fetchMailBody",
            mailId: message.mailId
        }).then(response => {
            if (!response.success) {
                console.error("[Background]: 请求邮件正文失败:", response.error);
            }
        });
    } else if (message.action === "mailContentFetched") {
        console.log(`[Background]: 收到Content Script的邮件正文: ${message.mailId}`);
        // 邮件正文已获取，现在运行规则引擎
        runRulesEngine(message.mailId, message.body, message.subject, sender.tab.id);
    } else if (message.action === "tagsUpdated") {
        cachedTags = message.tags;
        console.log("[Background]: 已从Content Script更新缓存标签:", cachedTags);
    } else if (message.action === "foldersUpdated") {
        cachedFolders = message.folders;
        console.log("[Background]: 已从Content Script更新缓存文件夹:", cachedFolders);
    }
});

// ===============================================
// 初始化
// ===============================================

// 主动获取标签和文件夹数据
async function fetchTagsAndFoldersData() {
    try {
        // 查找阿里邮箱页面
        const tabs = await chrome.tabs.query({url: "https://qiye.aliyun.com/alimail/*"});
        if (tabs.length > 0) {
            const tabId = tabs[0].id;
            console.log(`[Background]: 尝试从Tab ${tabId} 获取标签和文件夹数据...`);
            
            // 向 Content Script 请求获取导航数据
            const response = await chrome.tabs.sendMessage(tabId, {
                action: "getMailNavData"
            });
            
            console.log("[Background]: 收到 Content Script 响应:", response);
            
            if (response && response.success) {
                // 更新缓存
                if (response.tags) {
                    cachedTags = response.tags;
                    console.log("[Background]: 成功更新标签缓存:", cachedTags);
                }
                if (response.folders) {
                    cachedFolders = response.folders;
                    console.log("[Background]: 成功更新文件夹缓存:", cachedFolders);
                }
                console.log("[Background]: 成功获取标签和文件夹数据");
                return true;
            } else {
                console.error("[Background]: 获取标签和文件夹数据失败:", response?.error);
                return false;
            }
        } else {
            console.log("[Background]: 未找到阿里邮箱页面，无法获取标签和文件夹数据");
            return false;
        }
    } catch (error) {
        console.error("[Background]: 获取标签和文件夹数据时出错:", error);
        return false;
    }
}

// 后台服务工作者启动时加载规则
loadRules();

// 延迟获取标签和文件夹数据，给页面一些时间加载
setTimeout(() => {
    fetchTagsAndFoldersData();
}, 3000);

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