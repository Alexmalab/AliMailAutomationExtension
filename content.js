// content.js - 运行在阿里邮箱页面上下文中的脚本

const BASE_URL = "https://qiye.aliyun.com/alimail/ajax/";

let CSRF_TOKEN = ''; // CSRF Token，需要动态获取
let TAG_NAME_TO_ID = {}; 
let FOLDER_NAME_TO_ID = {}; 


// ===============================================
// 辅助函数：获取 CSRF Token
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
    return CSRF_TOKEN;
}

// ===============================================
// 辅助函数：发起阿里邮箱 API 请求
// ===============================================

/**
 * 通用的阿里邮箱 API 请求函数
 * @param {string} path API 路径，例如 'mail/changeTags.txt'
 * @param {Object} bodyParams 请求体参数对象
 * @returns {Promise<Object>} API 响应的 JSON 数据
 */
async function aliMailApiRequest(path, bodyParams = {}) {
    const url = `${BASE_URL}${path}`;
    
    // 确保有最新的 CSRF Token
    if (!CSRF_TOKEN) { 
        getCsrfToken(); 
    }
    if (!CSRF_TOKEN) {
        console.error(`[Extension]: API请求 ${path} 失败：CSRF Token 不可用。`);
        return Promise.reject(new Error("CSRF Token not found."));
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
    formData.append('_csrf_token_', CSRF_TOKEN); 

    try {
        const response = await fetch(url, {
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
        console.log(`[Extension]: API请求 ${path} 成功:`, data.msg || '操作成功'); // 成功日志
        return data;
    } catch (error) {
        console.error(`[Extension]: API请求 ${path} 抛出异常:`, error); // 异常日志
        throw error;
    }
}


// ===============================================
// 第一部分：劫持网络请求 - 监听新邮件和获取元数据， 发送数据到 Background Script
// ===============================================

const originalFetch = window.fetch;
window.fetch = function(...args) {
    return originalFetch.apply(this, args)
        .then(async response => {
            const clonedResponse = response.clone();
            const url = args[0];

            try {
                // 1. 监听 getTimerRefreshData.txt 获取新邮件通知和元数据
                if (url.includes('alimail/ajax/navigate/getTimerRefreshData.txt')) {
                    const data = await clonedResponse.json();
                    if (data && data.newMailNotifyCount > 0 && Array.isArray(data.newStableIds)) {
                        console.log('>>> [Content Script]: 捕获到定时刷新数据，发现新邮件通知！');
                        for (const newMail of data.newStableIds) {
                            const mailId = newMail.mailId; 
                            console.log(`[Content Script]: [新邮件通知]: MailId: ${mailId}, Subject: ${newMail.encSubject || '无主题'}`);
                            
                            // 向 Background Script 发送获取正文的请求
                            chrome.runtime.sendMessage({
                                action: "newMailDetected",
                                mailId: mailId,
                                subject: newMail.encSubject || '无主题'
                            });
                        }
                    }
                }
                // 2. 捕获邮件正文内容 (loadMail.txt)
                else if (url.includes('alimail/ajax/mail/loadMail.txt')) {
                    const data = await clonedResponse.json();
                    const requestBody = args[1]?.body;
                    let mailId = 'unknown_id_from_loadmail_request';
                    if (requestBody && typeof requestBody === 'string') {
                        const mailIdMatch = requestBody.match(/mailId=([^&]+)/);
                        if (mailIdMatch) {
                            mailId = decodeURIComponent(mailIdMatch[1]);
                        }
                    }
                    
                    if (data && data.data && (data.data.htmlBody || data.data.textBody)) {
                        const bodyContent = data.data.htmlBody || data.data.textBody;
                        const subject = data.data.subject || data.data.encSubject || '无主题';
                        console.log(`>>> [Content Script]: 捕获到邮件正文 (ID: ${mailId}, 主题: "${subject}")`);

                        // 将邮件正文和元数据发送给 Background Script 进行规则匹配
                        chrome.runtime.sendMessage({
                            action: "mailContentFetched",
                            mailId: mailId,
                            body: bodyContent,
                            subject: subject
                        });
                    } else {
                        console.warn(`[Content Script]: 邮件 ${mailId} 正文数据不完整或无法解析。`);
                    }
                }
                // 3. 捕获标签和文件夹数据 (getMailNavData.txt)
                else if (url.includes('alimail/ajax/navigate/getMailNavData.txt')) {
                    const data = await clonedResponse.json();
                    if (data && Array.isArray(data.tags)) {
                        TAG_NAME_TO_ID = data.tags.reduce((map, tag) => {
                            map[tag.name] = tag.id;
                            return map;
                        }, {});
                        console.log("[Content Script]: 已更新标签映射:", TAG_NAME_TO_ID);
                        // 将标签数据发送给 Background Script，以便 Options Page 获取
                        chrome.runtime.sendMessage({
                            action: "tagsUpdated",
                            tags: TAG_NAME_TO_ID
                        });
                    }
                     if (data && Array.isArray(data.folders)) {
                        FOLDER_NAME_TO_ID = data.folders.reduce((map, folder) => {
                            map[folder.name] = folder.id;
                            return map;
                        }, {});
                        console.log("[Content Script]: 已更新文件夹映射:", FOLDER_NAME_TO_ID);
                        // 将文件夹数据发送给 Background Script
                        chrome.runtime.sendMessage({
                            action: "foldersUpdated",
                            folders: FOLDER_NAME_TO_ID
                        });
                    }
                }

            } catch (e) {
                // console.warn("[Content Script]: Error in fetch interceptor for:", url, e);
            }
            return response;
        })
        .catch(error => {
            console.error("[Content Script]: Fetch API劫持出错:", error);
            throw error;
        });
};

const originalXHRopen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url) {
    this._url = url;
    return originalXHRopen.apply(this, arguments);
};
const originalXHRsend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('loadend', () => {
        if (this.readyState === 4 && this.status === 200) {
            try {
                // If XHR requests also return mail data, process similarly to Fetch
            } catch (e) {
                // console.warn("[Content Script]: XHR劫持出错或响应非JSON:", e);
            }
        }
    });
    return originalXHRsend.apply(this, args);
};


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
        return { success: true, mailId: mailId, data: result }; // 返回成功结果
    } catch (e) {
        console.error(`[Content Script]: 请求邮件 ${mailId} 正文失败:`, e); 
        return { success: false, mailId: mailId, error: e.message }; // 返回失败结果
    }
}

/**
 * 为邮件打标签。由 Background Script 调用。
 * @param {string[]} mailIds 邮件ID列表
 * @param {string[]} tagIds 标签ID列表
 */
async function applyLabelToMailFromBackground(mailIds, tagIds) {
    console.log(`[Content Script]: 收到Background Script请求，尝试为邮件 ${mailIds.join(', ')} 应用标签 ${tagIds.join(', ')}...`);
    try {
        const result = await applyLabelToMail(mailIds, tagIds); // 调用下方的 API 函数
        console.log(`[Content Script]: 成功为邮件 ${mailIds.join(', ')} 应用标签 ${tagIds.join(', ')}.`, result);
        return { success: true, mailIds: mailIds, action: 'applyLabel', data: result };
    } catch (e) {
        console.error(`[Content Script]: 失败为邮件 ${mailIds.join(', ')} 应用标签 ${tagIds.join(', ')}:`, e);
        return { success: false, mailIds: mailIds, action: 'applyLabel', error: e.message };
    }
}

/**
 * 移动邮件到指定文件夹。由 Background Script 调用。
 * @param {string} mailId 邮件的mailId
 * @param {string} folderId 目标文件夹的内部ID
 */
async function moveMailToFolderFromBackground(mailId, folderId) {
    console.log(`[Content Script]: 收到Background Script请求，尝试将邮件 ${mailId} 移动到文件夹 ${folderId}...`);
    try {
        const result = await moveMailToFolder(mailId, folderId); // 调用下方的 API 函数
        console.log(`[Content Script]: 成功将邮件 ${mailId} 移动到文件夹 ${folderId}.`, result);
        return { success: true, mailId: mailId, action: 'moveFolder', data: result };
    } catch (e) {
        console.error(`[Content Script]: 失败将邮件 ${mailId} 移动到文件夹 ${folderId}:`, e);
        return { success: false, mailId: mailId, action: 'moveFolder', error: e.message };
    }
}

/**
 * 标记邮件为已读或未读。由 Background Script 调用。
 * @param {string} mailId 邮件的mailId
 * @param {boolean} isRead 是否标记为已读 (true) 或未读 (false)
 */
async function markMailAsReadFromBackground(mailId, isRead = true) {
    console.log(`[Content Script]: 收到Background Script请求，尝试标记邮件 ${mailId} 为 ${isRead ? '已读' : '未读'}...`);
    try {
        const result = await markMailAsRead(mailId, isRead); // 调用下方的 API 函数
        console.log(`[Content Script]: 成功标记邮件 ${mailId} 为 ${isRead ? '已读' : '未读'}.`, result);
        return { success: true, mailId: mailId, action: 'markRead', data: result };
    } catch (e) {
        console.error(`[Content Script]: 失败标记邮件 ${mailId} 为 ${isRead ? '已读' : '未读'}:`, e);
        return { success: false, mailId: mailId, action: 'markRead', error: e.message };
    }
}

/**
 * 获取收件箱未读邮件列表。由 Background Script 调用。
 */
async function getInboxUnreadMailsFromBackground() {
    console.log(`[Content Script]: 收到Background Script请求，获取收件箱未读邮件列表...`);
    try {
        // 调用阿里邮箱API获取收件箱未读邮件
        const result = await aliMailApiRequest('mail/getMailList.txt', {
            folderId: 'inbox', // 收件箱
            start: 0,
            limit: 100, // 限制获取100封邮件
            sort: 'date',
            dir: 'desc',
            read: 0 // 只获取未读邮件
        });
        
        if (result && result.data && Array.isArray(result.data.mails)) {
            const unreadMails = result.data.mails.map(mail => ({
                mailId: mail.mailId,
                subject: mail.subject || mail.encSubject || '无主题',
                from: mail.from,
                date: mail.date
            }));
            
            console.log(`[Content Script]: 成功获取 ${unreadMails.length} 封未读邮件`);
            return { success: true, mails: unreadMails };
        } else {
            console.warn(`[Content Script]: 未读邮件数据格式异常:`, result);
            return { success: false, error: '未读邮件数据格式异常' };
        }
    } catch (e) {
        console.error(`[Content Script]: 获取收件箱未读邮件失败:`, e); 
        return { success: false, error: e.message };
    }
}

// 监听来自 Background Script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "fetchMailBody") {
        fetchMailBodyFromBackground(message.mailId).then(sendResponse);
        return true; // 表示异步响应
    } else if (message.action === "applyLabel") {
        applyLabelToMailFromBackground(message.mailIds, message.tagIds).then(sendResponse);
        return true;
    } else if (message.action === "moveMail") {
        moveMailToFolderFromBackground(message.mailId, message.folderId).then(sendResponse);
        return true;
    } else if (message.action === "markRead") {
        markMailAsReadFromBackground(message.mailId, message.isRead).then(sendResponse);
        return true;
    } else if (message.action === "getMailNavData") { // Background Script 可能需要主动获取标签/文件夹数据
        getCsrfToken(); // 确保有最新的CSRF Token
        aliMailApiRequest('navigate/getMailNavData.txt', {
            queryFolder: 1,
            queryPop: 0,
            queryTag: 1,
            queryStack: 0
        }).then(sendResponse).catch(e => sendResponse({success: false, error: e.message}));
        return true;
    } else if (message.action === "getInboxUnreadMails") { // 获取收件箱未读邮件
        getInboxUnreadMailsFromBackground().then(sendResponse);
        return true;
    }
});


// ===============================================
// 第三部分：底层 API 调用函数，实现阿里邮箱操作 API
// ===============================================

/**
 * 为邮件打标签
 * @param {string[]} mailIds 邮件ID列表
 * @param {string[]} tagIds 标签ID列表
 * @returns {Promise<Object>} API 响应
 */
async function applyLabelToMail(mailIds, tagIds) {
    console.log(`[Extension]: 尝试为邮件 ${mailIds.join(', ')} 调用 applyLabelToMail API (tagIds: ${tagIds.join(', ')})...`);
    const body = {
        mails: mailIds,
        tagAdd: tagIds,
        tagRemove: [],
        tagCount: 0
    };
    try {
        const result = await aliMailApiRequest('mail/changeTags.txt', body);
        console.log(`[Extension]: applyLabelToMail 成功为邮件 ${mailIds.join(', ')} 应用标签 ${tagIds.join(', ')}.`, result); // 成功日志
        return result;
    } catch (e) {
        console.error(`[Extension]: applyLabelToMail 失败为邮件 ${mailIds.join(', ')} 应用标签 ${tagIds.join(', ')}:`, e); // 失败日志
        throw e;
    }
}

/**
 * 移动邮件到指定文件夹
 * @param {string} mailId 邮件的mailId
 * @param {string} folderId 目标文件夹的内部ID
 * @returns {Promise<Object>} API 响应
 */
async function moveMailToFolder(mailId, folderId) {
    console.log(`[Extension]: 尝试为邮件 ${mailId} 调用 moveMailToFolder API (folderId: ${folderId})...`);
    const body = {
        mails: [mailId], 
        folderCount: 1, 
        tagCount: 0,
        op: 'move', 
        argument: folderId 
    };
    try {
        const result = await aliMailApiRequest('mail/operateMails.txt', body);
        console.log(`[Extension]: moveMailToFolder 成功将邮件 ${mailId} 移动到文件夹 ${folderId}.`, result); // 成功日志
        return result;
    } catch (e) {
        console.error(`[Extension]: moveMailToFolder 失败将邮件 ${mailId} 移动到文件夹 ${folderId}:`, e); // 失败日志
        throw e;
    }
}

/**
 * 标记邮件为已读或未读
 * @param {string} mailId 邮件的mailId
 * @param {boolean} isRead 是否标记为已读 (true) 或未读 (false)
 * @returns {Promise<Object>} API 响应
 */
async function markMailAsRead(mailId, isRead = true) {
    console.log(`[Extension]: 尝试为邮件 ${mailId} 调用 markMailAsRead API (isRead: ${isRead})...`);
    const body = {
        mails: [mailId],
        read: isRead ? 1 : 0, 
        folderCount: 0,
        tagCount: 1 
    };
    try {
        const result = await aliMailApiRequest('mail/markRead.txt', body);
        console.log(`[Extension]: markMailAsRead 成功标记邮件 ${mailId} 为 ${isRead ? '已读' : '未读'}.`, result); // 成功日志
        return result;
    } catch (e) {
        console.error(`[Extension]: markMailAsRead 失败标记邮件 ${mailId} 为 ${isRead ? '已读' : '未读'}:`, e); // 失败日志
        throw e;
    }
}


// ===============================================
// 初始化和调试
// ===============================================

console.log("[Extension]: Ali Mail Advanced Automation Content Script Loaded.");

// 页面加载后，尝试获取 CSRF Token 并初始化标签和文件夹映射
window.addEventListener('load', async () => {
    console.log("[Extension]: Ali Mail page fully loaded. Initializing data...");
    getCsrfToken(); // 确保获取最新CSRF Token

    try {
        // 在页面加载时主动请求一次导航数据，获取标签和文件夹ID
        const navData = await aliMailApiRequest('navigate/getMailNavData.txt', {
            queryFolder: 1,
            queryPop: 0,
            queryTag: 1,
            queryStack: 0
        });
        console.log("[Extension]: 初始获取标签/文件夹数据成功。", navData); // 成功日志
    } catch (e) {
        console.error("[Extension]: 初始获取标签/文件夹数据失败:", e); // 失败日志
    }
});
