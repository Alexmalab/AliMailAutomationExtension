// content.js - 阿里邮箱内容脚本

// 全局变量定义
let TAG_NAME_TO_ID = {};
let FOLDER_NAME_TO_ID = {};
const BASE_URL = 'https://qiye.aliyun.com/alimail/ajax/';

// ===============================================
// 获取CSRF Token
// ===============================================

function getCsrfToken() {
    let token = '';
    const inputField = document.querySelector('input[name="_csrf_token_"][type="hidden"]');
    if (inputField && inputField.value) {
        token = inputField.value;
    } else {
        const metaTag = document.querySelector('meta[name="_csrf_token_"]');
        if (metaTag && metaTag.content) {
            token = metaTag.content;
        } else {
            const csrfCookie = document.cookie.split('; ').find(row => row.trim().startsWith('_csrf_token_='));
            if (csrfCookie) {
                token = csrfCookie.split('=')[1];
            } else {
                console.warn("[Extension]: 警告：无法从DOM（input/meta）或Cookie获取CSRF Token！后续API请求可能失败。");
            }
        }
    }
    
    if (token) {
        CSRF_TOKEN = token;
        // console.log("[Extension]: CSRF Token 已获取:", CSRF_TOKEN.substring(0, 10) + '...');
    } else {
        console.error("[Extension]: 警告：CSRF Token 未能获取！请检查页面CSRF token机制。");
    }
    return token;
}

// ===============================================
// 存储操作函数
// ===============================================

async function saveTagsToStorage(tags) {
    try {
        await chrome.storage.local.set({ aliMailTags: tags });
        console.log('[Content Script]: 标签数据已保存到存储:', tags);
    } catch (error) {
        console.error('[Content Script]: 保存标签数据失败:', error);
    }
}

async function saveFoldersToStorage(folders) {
    try {
        await chrome.storage.local.set({ aliMailFolders: folders });
        console.log('[Content Script]: 文件夹数据已保存到存储:', folders);
    } catch (error) {
        console.error('[Content Script]: 保存文件夹数据失败:', error);
    }
}

// ===============================================
// API请求函数
// ===============================================

async function aliMailApiRequest(path, bodyParams = {}) {
    const csrfToken = getCsrfToken();
    
    if (!csrfToken) {
        console.error(`[Extension]: API请求 ${path} 失败：CSRF Token 不可用。`);
        return Promise.reject(new Error("CSRF Token not found for API request."));
    }

    const formData = new URLSearchParams();
    for (const key in bodyParams) {
        if (Array.isArray(bodyParams[key]) || typeof bodyParams[key] === 'object') {
            formData.append(key, JSON.stringify(bodyParams[key]));
        } else {
            formData.append(key, bodyParams[key]);
        }
    }
    formData.append('_tpl_', 'v5ForWebDing');
    formData.append('_refer_hash_', '');
    formData.append('_root_token_', '');
    formData.append('_csrf_token_', csrfToken);

    try {
        const response = await fetch(`${BASE_URL}${path}`, {
            method: 'POST',
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'en,zh-CN;q=0.9,zh;q=0.8',
                'content-type': 'application/x-www-form-urlencoded',
            },
            body: formData.toString()
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[Extension]: API请求 ${path} 失败 (HTTP Status: ${response.status}): ${errorText}`);
            throw new Error(`API Request failed with status ${response.status}: ${path}`);
        }
        const data = await response.json();
        if (data.status !== 0) {
            console.error(`[Extension]: API请求 ${path} 失败 (API Status: ${data.status}): ${data.msg || '未知错误'}`);
            throw new Error(`API Error: ${data.msg || '未知错误'} for ${path}`);
        }
        console.log(`[Extension]: API请求 ${path} 成功:`, data.msg || '操作成功');
        return data;
    } catch (error) {
        console.error(`[Extension]: API请求 ${path} 抛出异常:`, error);
        throw error;
    }
}

// ===============================================
// 注入网络劫持代码到页面主环境
// ===============================================

function injectNetworkInterception() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = function() {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
    
    console.log('[Content Script]: 网络劫持脚本已注入');
}

// ===============================================
// 事件监听器设置 (现在已不需要自定义事件监听器)
// ===============================================

function setupEventListeners() {
    // 监听来自inject.js的自定义事件
    window.addEventListener('alimail_new_mail_detected', (event) => {
        const { mailId, subject } = event.detail;
        console.log(`[Content Script]: 收到新邮件事件 - ID: ${mailId}, 主题: "${subject}"`);
        
        chrome.runtime.sendMessage({
            action: "newMailDetected",
            mailId: mailId,
            subject: subject
        });
    });
    
    window.addEventListener('alimail_new_mail_id_detected', (event) => {
        const { mailId, sender } = event.detail;
        console.log(`[Content Script]: 收到新邮件ID事件 - ID: ${mailId}, Sender: ${sender}`);
        
        chrome.runtime.sendMessage({
            action: "newMailIdDetected",
            mailId: mailId,
            sender: sender
        });
    });
    
    window.addEventListener('alimail_mail_content_fetched', (event) => {
        const { mailId, body, subject, sender, recipient, ccRecipients } = event.detail;
        console.log(`[Content Script]: 收到邮件内容事件 - ID: ${mailId}, 主题: "${subject}", Sender: ${sender}, Recipient: ${recipient}, CC Recipients: ${ccRecipients}`);
        
        chrome.runtime.sendMessage({
            action: "mailContentFetched",
            mailId: mailId,
            body: body,
            subject: subject,
            sender: sender,
            recipient: recipient,
            ccRecipients: ccRecipients
        });
    });
    
    window.addEventListener('alimail_nav_data_updated', async (event) => {
        const { tags, folders } = event.detail;
        console.log(`[Content Script]: 收到导航数据更新事件`);
        
        if (tags && Object.keys(tags).length > 0) {
            TAG_NAME_TO_ID = tags;
            await saveTagsToStorage(TAG_NAME_TO_ID);
            chrome.runtime.sendMessage({
                action: "tagsUpdated",
                tags: TAG_NAME_TO_ID
            });
        }
        
        if (folders && Object.keys(folders).length > 0) {
            FOLDER_NAME_TO_ID = folders;
            await saveFoldersToStorage(FOLDER_NAME_TO_ID);
            chrome.runtime.sendMessage({
                action: "foldersUpdated",
                folders: FOLDER_NAME_TO_ID
            });
        }
    });
    

    console.log('[Content Script]: 事件监听器已设置完成');
}

// ===============================================
// 第二部分：供 Background Script 调用的操作函数 (通过消息传递)
// ===============================================

/**
 * 请求邮件正文。由 Background Script 调用。
 * @param {string} mailId 邮件的mailId
 */
async function fetchMailBodyFromBackground(mailId) {
    console.log(`[Content Script]: 收到Background Script请求，主动请求邮件 ${mailId} 的正文...`);
    try {
        const result = await aliMailApiRequest('mail/loadMail.txt', {
            mailId: mailId,
            full: 1 
        });
        const mailData = result.data || {};
        const sender = mailData.senderName || mailData.senderAddress || mailData.from;
        const recipient = mailData.receiverName || mailData.receiverAddress || mailData.to;
        const ccRecipients = mailData.ccList || mailData.cc;

        return { 
            success: true, 
            mailId: mailId, 
            data: result,
            subject: mailData.subject || mailData.encSubject,
            body: mailData.htmlBody || mailData.textBody,
            sender: sender,
            recipient: recipient,
            ccRecipients: ccRecipients
        };
    } catch (e) {
        console.error(`[Content Script]: 请求邮件 ${mailId} 正文失败:`, e); 
        return { success: false, mailId: mailId, error: e.message };
    }
}

/**
 * 为邮件打标签。由 Background Script 调用。
 * @param {string[]} mailIds 邮件ID列表
 * @param {string[]} tagIds 标签ID列表
 */
async function applyLabelToMailFromBackground(mailIds, tagIds) {
    console.log(`[Content Script]: 收到Background Script请求，为邮件 ${mailIds} 打标签 ${tagIds}...`);
    try {
        await applyLabelToMail(mailIds, tagIds);
        return { success: true, mailIds: mailIds, tagIds: tagIds };
    } catch (e) {
        console.error(`[Content Script]: 为邮件 ${mailIds} 打标签失败:`, e);
        return { success: false, mailIds: mailIds, tagIds: tagIds, error: e.message };
    }
}

/**
 * 移动邮件到文件夹。由 Background Script 调用。
 * @param {string} mailId 邮件ID
 * @param {string} folderId 文件夹ID
 */
async function moveMailToFolderFromBackground(mailId, folderId) {
    console.log(`[Content Script]: 收到Background Script请求，移动邮件 ${mailId} 到文件夹 ${folderId}...`);
    try {
        await moveMailToFolder(mailId, folderId);
        return { success: true, mailId: mailId, folderId: folderId };
    } catch (e) {
        console.error(`[Content Script]: 移动邮件 ${mailId} 到文件夹失败:`, e);
        return { success: false, mailId: mailId, folderId: folderId, error: e.message };
    }
}

/**
 * 标记邮件为已读/未读。由 Background Script 调用。
 * @param {string} mailId 邮件ID
 * @param {boolean} isRead 是否已读
 */
async function markMailAsReadFromBackground(mailId, isRead = true) {
    console.log(`[Content Script]: 收到Background Script请求，标记邮件 ${mailId} 为 ${isRead ? '已读' : '未读'}...`);
    try {
        await markMailAsRead(mailId, isRead);
        return { success: true, mailId: mailId, isRead: isRead };
    } catch (e) {
        console.error(`[Content Script]: 标记邮件 ${mailId} 状态失败:`, e);
        return { success: false, mailId: mailId, isRead: isRead, error: e.message };
    }
}

/**
 * 通用的邮件列表查询函数。由 Background Script 调用。
 * @param {string[]} folderIds 文件夹ID列表，默认为收件箱["2"]
 * @param {boolean} unreadOnly 是否只查询未读邮件，默认为false
 * @param {number} maxLength 最大返回数量，默认为100
 * @param {number} offset 偏移量，默认为0
 */
async function queryMailListFromBackground(folderIds = ["2"], unreadOnly = false, maxLength = 100, offset = 0) {
    const folderNames = folderIds.join(',');
    console.log(`[Content Script]: 查询邮件列表 - 文件夹: [${folderNames}], 仅未读: ${unreadOnly}, 数量: ${maxLength}`);
    
    try {
        const queryParams = {
            folderIds: folderIds
        };
        
        // 如果只查询未读邮件，添加unread参数
        if (unreadOnly) {
            queryParams.unread = true;
        }
        
        const result = await aliMailApiRequest('mail/queryMailList.txt', {
            query: JSON.stringify(queryParams),
            showFrom: 0,
            offset: offset,
            length: maxLength
        });
        
        if (result && result.dataList) {
            console.log(`[Content Script]: 从文件夹 [${folderNames}] 获取到 ${result.dataList.length} 封邮件`);
            return { 
                success: true, 
                mails: result.dataList,
                totalCount: result.totalCount || result.dataList.length,
                folderIds: folderIds,
                unreadOnly: unreadOnly
            };
        } else {
            console.log(`[Content Script]: 文件夹 [${folderNames}] 查询结果为空`);
            return { 
                success: true, 
                mails: [], 
                totalCount: 0,
                folderIds: folderIds,
                unreadOnly: unreadOnly
            };
        }
    } catch (e) {
        console.error(`[Content Script]: 查询文件夹 [${folderNames}] 邮件列表失败:`, e);
        return { success: false, error: e.message, folderIds: folderIds };
    }
}

/**
 * 获取收件箱未读邮件列表（保持向后兼容）
 */
async function getInboxUnreadMailsFromBackground() {
    console.log(`[Content Script]: 收到Background Script请求，获取收件箱未读邮件列表...`);
    return await queryMailListFromBackground(["2"], true, 100, 0);
}

/**
 * 移动邮件后从指定文件夹获取邮件以验证新的mailId。由 Background Script 调用。
 * @param {string} originalUniqueId 邮件的原始唯一ID部分（冒号后的部分）
 * @param {string} targetFolderId 目标文件夹ID
 * @param {number} maxResults 最大结果数量，默认为5
 */
async function getMailFromFolderAfterMove(originalUniqueId, targetFolderId, maxResults = 5) {
    console.log(`[Content Script]: 验证邮件移动结果，查找唯一ID: ${originalUniqueId} 在文件夹: ${targetFolderId}`);
    try {
        const result = await aliMailApiRequest('mail/queryMailList.txt', {
            query: JSON.stringify({
                folderIds: [targetFolderId]
            }),
            showFrom: 0,
            offset: 0,
            length: maxResults
        });
        
        if (result && result.dataList) {
            console.log(`[Content Script]: 从文件夹 ${targetFolderId} 获取到 ${result.dataList.length} 封邮件`);
            
            // 查找匹配的邮件
            for (const mail of result.dataList) {
                // 检查邮件ID或mailId是否包含原始唯一ID
                const mailUniqueId = mail.id || '';
                const fullMailId = mail.mailId || '';
                
                console.log(`[Content Script]: 检查邮件 - ID: ${mailUniqueId}, mailId: ${fullMailId}`);
                
                if (mailUniqueId === originalUniqueId || fullMailId.includes(originalUniqueId)) {
                    console.log(`[Content Script]: 找到匹配的邮件 - 新mailId: ${fullMailId}`);
                    return { 
                        success: true, 
                        found: true,
                        newMailId: fullMailId,
                        mailData: mail
                    };
                }
            }
            
            console.warn(`[Content Script]: 在文件夹 ${targetFolderId} 中未找到唯一ID为 ${originalUniqueId} 的邮件`);
            return { 
                success: true, 
                found: false,
                searchedMails: result.dataList.length
            };
        } else {
            console.warn(`[Content Script]: 文件夹 ${targetFolderId} 查询结果为空`);
            return { success: true, found: false, searchedMails: 0 };
        }
    } catch (e) {
        console.error(`[Content Script]: 验证邮件移动失败:`, e);
        return { success: false, error: e.message };
    }
}

// ===============================================
// 第三部分：Content Script 内部调用的操作函数 (直接API调用)
// ===============================================

/**
 * 为邮件打标签
 * @param {string[]} mailIds 邮件ID列表
 * @param {string[]} tagIds 标签ID列表
 */
async function applyLabelToMail(mailIds, tagIds) {
    const mailsArray = Array.isArray(mailIds) ? mailIds : [mailIds];
    const tagsArray = Array.isArray(tagIds) ? tagIds : [tagIds];
    
    console.log(`[Content Script]: 为邮件 ${mailsArray.join(',')} 添加标签 ${tagsArray.join(',')}`);
    
    try {
        await aliMailApiRequest('mail/changeTags.txt', {
            mails: mailsArray,
            tagAdd: tagsArray,
            tagRemove: [],
            tagCount: 0
        });
        console.log('[Content Script]: 标签添加成功');
        return true;
    } catch (error) {
        console.error('[Content Script]: 添加标签失败:', error);
        throw error;
    }
}

/**
 * 移动邮件到文件夹
 * @param {string} mailId 邮件ID
 * @param {string} folderId 文件夹ID
 */
async function moveMailToFolder(mailId, folderId) {
    console.log(`[Content Script]: 移动邮件 ${mailId} 到文件夹 ${folderId}`);
    
    try {
        await aliMailApiRequest('mail/operateMails.txt', {
            mails: [mailId],
            folderCount: 1,
            tagCount: 0,
            op: 'move',
            argument: folderId
        });
        console.log('[Content Script]: 邮件移动成功');
        return true;
    } catch (error) {
        console.error('[Content Script]: 移动邮件失败:', error);
        throw error;
    }
}

/**
 * 标记邮件为已读/未读
 * @param {string} mailId 邮件ID
 * @param {boolean} isRead 是否已读
 */
async function markMailAsRead(mailId, isRead = true) {
    console.log(`[Content Script]: 标记邮件 ${mailId} 为 ${isRead ? '已读' : '未读'}`);
    
    try {
        await aliMailApiRequest('mail/markRead.txt', {
            mails: [mailId],
            read: isRead ? 1 : 0,
            folderCount: 0,
            tagCount: 1
        });
        console.log('[Content Script]: 邮件状态标记成功');
        return true;
    } catch (error) {
        console.error('[Content Script]: 标记邮件状态失败:', error);
        throw error;
    }
}

// ===============================================
// 第四部分：消息监听
// ===============================================

// 监听来自 Background Script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[Content Script]: 收到Background Script消息:', request);
    
    switch (request.action) {
        case 'fetchMailBody':
            fetchMailBodyFromBackground(request.mailId)
                .then(result => sendResponse(result))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true; // 保持消息通道开放
            
        case 'applyLabelToMail':
        case 'applyLabel':  // 兼容Background Script发送的消息
            applyLabelToMailFromBackground(request.mailIds, request.tagIds)
                .then(result => sendResponse(result))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;
            
        case 'moveMailToFolder':
        case 'moveMail':  // 兼容Background Script发送的消息
            moveMailToFolderFromBackground(request.mailId, request.folderId)
                .then(result => sendResponse(result))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;
            
        case 'markMailAsRead':
        case 'markRead':  // 兼容Background Script发送的消息
            markMailAsReadFromBackground(request.mailId, request.isRead)
                .then(result => sendResponse(result))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;
            
        case 'getInboxUnreadMails':
            getInboxUnreadMailsFromBackground()
                .then(result => sendResponse(result))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;
            
        case 'queryMailList':
            queryMailListFromBackground(
                request.folderIds, 
                request.unreadOnly, 
                request.maxLength, 
                request.offset
            )
                .then(result => sendResponse(result))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;
            
        case 'verifyMailMove':
            getMailFromFolderAfterMove(request.originalUniqueId, request.targetFolderId, request.maxResults)
                .then(result => sendResponse(result))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;
    }
});

// ===============================================
// 初始化
// ===============================================

console.log('[Extension]: Ali Mail Advanced Automation Content Script Loaded.');

// 等待页面完全加载后再初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtension);
} else {
    initializeExtension();
}

async function initializeExtension() {
    console.log('[Extension]: Ali Mail page fully loaded. Initializing data...');
    
    // 设置事件监听器
    setupEventListeners();
    
    // 注入网络劫持代码到页面主环境
    injectNetworkInterception();
    
    try {
        // 在页面加载时主动请求一次导航数据，获取标签和文件夹ID
        const navData = await aliMailApiRequest('navigate/getMailNavData.txt', {
            queryFolder: 1,
            queryPop: 0,
            queryTag: 1,
            queryStack: 0
        });
        console.log('[Extension]: 初始获取标签/文件夹数据成功。', navData);
        
        // 处理标签数据
        if (navData && navData.tags && Array.isArray(navData.tags)) {
            TAG_NAME_TO_ID = navData.tags.reduce((map, tag) => {
                map[tag.name] = tag.id;
                return map;
            }, {});
            console.log('[Content Script]: 初始化时更新标签映射:', TAG_NAME_TO_ID);
            await saveTagsToStorage(TAG_NAME_TO_ID);
            // 发送给 Background Script
            chrome.runtime.sendMessage({
                action: "tagsUpdated",
                tags: TAG_NAME_TO_ID
            });
        }
        
        // 处理文件夹数据
        if (navData && navData.folders && Array.isArray(navData.folders)) {
            FOLDER_NAME_TO_ID = navData.folders.reduce((map, folder) => {
                map[folder.name] = folder.id;
                return map;
            }, {});
            console.log('[Content Script]: 初始化时更新文件夹映射:', FOLDER_NAME_TO_ID);
            await saveFoldersToStorage(FOLDER_NAME_TO_ID);
            // 发送给 Background Script
            chrome.runtime.sendMessage({
                action: "foldersUpdated",
                folders: FOLDER_NAME_TO_ID
            });
        }
        
    } catch (error) {
        console.error('[Extension]: 初始化时获取标签/文件夹数据失败:', error);
        console.log('[Extension]: 将依靠网络劫持来获取数据');
    }
}
