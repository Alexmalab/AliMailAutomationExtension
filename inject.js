// inject.js - 注入到页面主环境的网络劫持代码

(function() {
    console.log('[页面环境]: 开始设置网络劫持...');
    
    // 局部变量：存储待处理的新邮件ID
    let pendingNewMailIds = new Set();
    
    // 劫持XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    
    XMLHttpRequest.prototype.open = function(method, url) {
        this._interceptedUrl = url;
        this._interceptedMethod = method;
        return originalXHROpen.apply(this, arguments);
    };
    
    XMLHttpRequest.prototype.send = function(data) {
        const url = this._interceptedUrl;
        const method = this._interceptedMethod;
        
        // 只处理阿里邮箱相关的请求
        if (url && url.includes('alimail/ajax/')) {
            // 对 queryMailList.txt 请求增加特别日志
            if (url.includes('queryMailList.txt')) {
                console.log(`[页面环境]: 🎯 重点劫持 queryMailList.txt - ${method} ${url}`);
                console.log(`[页面环境]: 请求数据:`, data);
            } else {
                console.log(`[页面环境]: 劫持到XHR请求 - ${method} ${url}`);
            }
            
            this.addEventListener('loadend', () => {
                if (this.readyState === 4 && this.status === 200) {
                    try {
                        // 1. 监听 getTimerRefreshData.txt 获取新邮件ID
                        if (url.includes('alimail/ajax/navigate/getTimerRefreshData.txt')) {
                            const responseData = JSON.parse(this.responseText);
                            console.log('[页面环境]: getTimerRefreshData 响应:', responseData);
                            
                            // 检查是否有新邮件通知
                            if (responseData && responseData.mailIncrements && responseData.mailIncrements.newMailNotifyCount > 0) {
                                console.log('>>> [页面环境]: 捕获到定时刷新数据，发现新邮件通知！');
                                console.log(`[页面环境]: 新邮件数量: ${responseData.mailIncrements.newMailNotifyCount}`);
                                
                                // 清空之前的待处理邮件ID（新的刷新周期）
                                pendingNewMailIds.clear();
                                
                                // 从 newStableIds 收集所有新邮件ID
                                if (responseData.mailIncrements.newStableIds) {
                                    for (const folderId in responseData.mailIncrements.newStableIds) {
                                        const newMails = responseData.mailIncrements.newStableIds[folderId];
                                        if (Array.isArray(newMails)) {
                                            console.log(`[页面环境]: 文件夹 ${folderId} 中发现 ${newMails.length} 封新邮件`);
                                            
                                            for (const newMail of newMails) {
                                                const mailId = newMail.mailId;
                                                pendingNewMailIds.add(mailId);
                                                console.log(`[页面环境]: 添加待处理邮件ID: ${mailId}`);
                                            }
                                        }
                                    }
                                }
                                
                                console.log(`[页面环境]: 总共收集了 ${pendingNewMailIds.size} 封新邮件ID，立即通知Background Script处理`);
                                
                                // 立即通知每个新邮件ID，不等待queryMailList劫持
                                for (const mailId of pendingNewMailIds) {
                                    console.log(`[页面环境]: 发送新邮件ID通知: ${mailId}`);
                                    window.dispatchEvent(new CustomEvent('alimail_new_mail_id_detected', {
                                        detail: {
                                            mailId: mailId
                                        }
                                    }));
                                }
                                
                                // 清空待处理列表，因为已经全部通知了
                                pendingNewMailIds.clear();
                            }
                        }
                        // 2. 监听 queryMailList.txt（保留用于调试，但不再依赖）
                        else if (url.includes('alimail/ajax/mail/queryMailList.txt')) {
                            const responseData = JSON.parse(this.responseText);
                            // console.log('[页面环境]: queryMailList 响应:', responseData);
                            // 不再处理待处理邮件ID，因为我们已经主动通知了
                        }
                        // 3. 捕获标签和文件夹数据 (getMailNavData.txt)
                        else if (url.includes('alimail/ajax/navigate/getMailNavData.txt')) {
                            const responseData = JSON.parse(this.responseText);
                            
                            let tagsData = {};
                            let foldersData = {};
                            
                            if (responseData && Array.isArray(responseData.tags)) {
                                tagsData = responseData.tags.reduce((map, tag) => {
                                    map[tag.name] = tag.id;
                                    return map;
                                }, {});
                                console.log("[页面环境]: 已更新标签映射:", tagsData);
                            }
                            
                            if (responseData && Array.isArray(responseData.folders)) {
                                foldersData = responseData.folders.reduce((map, folder) => {
                                    map[folder.name] = folder.id;
                                    return map;
                                }, {});
                                console.log("[页面环境]: 已更新文件夹映射:", foldersData);
                            }
                            
                            // 通过自定义事件发送给content script
                            if (Object.keys(tagsData).length > 0 || Object.keys(foldersData).length > 0) {
                                window.dispatchEvent(new CustomEvent('alimail_nav_data_updated', {
                                    detail: {
                                        tags: tagsData,
                                        folders: foldersData
                                    }
                                }));
                            }
                        }

                    } catch (e) {
                        console.warn("[页面环境]: XHR劫持处理出错:", url, e);
                    }
                }
            });
        }
        
        return originalXHRSend.apply(this, arguments);
    };
    
    console.log('[页面环境]: 网络劫持设置完成');
})(); 