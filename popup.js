// popup.js
document.addEventListener('DOMContentLoaded', () => {
    const manageRulesBtn = document.getElementById('manageRulesBtn');
    const manualRunBtn = document.getElementById('manualRunBtn');
    const statusText = document.getElementById('statusText');

    manageRulesBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage(); // 打开 options.html 页面
    });

    // 手动执行规则 - 遍历收件箱未读邮件
    manualRunBtn.addEventListener('click', async () => {
        manualRunBtn.disabled = true;
        manualRunBtn.textContent = '执行中...';
        statusText.textContent = '正在执行规则...';

        try {
            // 查找阿里邮箱页面
            const tabs = await chrome.tabs.query({url: "https://qiye.aliyun.com/alimail/*"});
            
            if (tabs.length === 0) {
                statusText.textContent = '请先打开阿里邮箱页面';
                manualRunBtn.disabled = false;
                manualRunBtn.textContent = '手动执行规则';
                return;
            }

            // 向 Background Script 发送手动执行规则的请求
            const response = await chrome.runtime.sendMessage({
                action: "manualExecuteRules",
                tabId: tabs[0].id
            });

            if (response && response.success) {
                let message = `完成! 处理: ${response.processedMailCount || 0}/${response.totalMailCountInScope || 0} 邮件.`;
                if (response.actionsTakenCounts) {
                    message += ` 已读: ${response.actionsTakenCounts.markedRead || 0}, 标签: ${response.actionsTakenCounts.labeled || 0}, 移动: ${response.actionsTakenCounts.moved || 0}.`;
                }
                if (response.message && response.processedMailCount === 0) {
                     statusText.textContent = response.message; 
                } else {
                    statusText.textContent = message;
                }
            } else {
                statusText.textContent = '规则执行失败: ' + (response?.error || '未知错误');
            }
        } catch (error) {
            console.error('手动执行规则时出错:', error);
            statusText.textContent = '规则执行失败: ' + error.message;
        } finally {
            manualRunBtn.disabled = false;
            manualRunBtn.textContent = '手动执行规则';
        }
    });

    // 初始化状态检查
    chrome.tabs.query({url: "https://qiye.aliyun.com/alimail/*"}, (tabs) => {
        if (tabs.length === 0) {
            statusText.textContent = '未检测到阿里邮箱页面';
            manualRunBtn.disabled = true;
        } else {
            statusText.textContent = '扩展已运行';
            manualRunBtn.disabled = false;
        }
    });
});