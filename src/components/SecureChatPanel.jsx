'use client';

import { cls } from '../lib/ui.jsx';

function SecureChatPanel({
  secureChat,
  secureChatSupported,
  contact,
  onEnableSecureChat,
  onUnlockSecureChat,
  onLockSecureChat,
  onAcceptSecureInvite,
  onCompleteSecureInvite,
  onRequestCloseSecureChat,
  onConfirmCloseSecureChat,
  onCancelCloseSecureChat,
  onCancelSecureInvite,
  onUnlockSecureHistory,
  onClose
}) {
  async function runSecureAction(action) {
    try {
      await action?.();
    } catch (err) {
      alert(err?.message || '安全聊天操作失败');
    }
  }

  const statusText = !secureChat
    ? '未开启'
    : secureChat.status === 'enabled'
      ? (secureChat.unlocked ? '已解锁' : '已锁定')
      : secureChat.status === 'closing'
        ? (secureChat.closeRequestedByMe ? '已申请关闭，等待对方确认' : '对方申请关闭，待你确认')
        : secureChat.status === 'waiting_peer'
          ? (secureChat.isInitiator
            ? (secureChat.peerAccepted ? '对方已同意，待你确认' : '等待对方同意')
            : (secureChat.peerAccepted ? '已同意，等待对方完成' : '收到邀请'))
          : (secureChat.hasHistoricalKeys
            ? (secureChat.historyUnlocked ? '未开启（历史已解锁）' : '未开启（有历史密文）')
            : '未开启');

  const actions = [];
  if (secureChat?.status === 'off') {
    actions.push({
      key: 'invite',
      label: '邀请开启',
      variant: 'primary',
      disabled: !secureChatSupported,
      onClick: () => runSecureAction(onEnableSecureChat)
    });
  }
  if (secureChat?.canUnlockHistory) {
    actions.push({
      key: 'unlock-history',
      label: '解锁历史消息',
      disabled: !secureChatSupported,
      onClick: () => runSecureAction(onUnlockSecureHistory)
    });
  }
  if (secureChat?.status === 'off' && secureChat.historyUnlocked && !secureChat.canUnlockHistory) {
    actions.push({
      key: 'lock-history',
      label: '锁定历史',
      onClick: () => runSecureAction(onLockSecureChat)
    });
  }
  if (secureChat?.canAcceptInvite) {
    actions.push({
      key: 'accept',
      label: '同意邀请',
      variant: 'primary',
      disabled: !secureChatSupported,
      onClick: () => runSecureAction(onAcceptSecureInvite)
    });
  }
  if (secureChat?.canCompleteInvite) {
    actions.push({
      key: 'complete',
      label: '确认开启',
      variant: 'primary',
      disabled: !secureChatSupported,
      onClick: () => runSecureAction(onCompleteSecureInvite)
    });
  }
  if ((secureChat?.status === 'enabled' || secureChat?.status === 'closing') && !secureChat.unlocked && secureChat.hasUserWrappedKey) {
    actions.push({
      key: 'unlock',
      label: '解锁会话',
      variant: 'primary',
      disabled: !secureChatSupported,
      onClick: () => runSecureAction(onUnlockSecureChat)
    });
  }
  if ((secureChat?.status === 'enabled' || secureChat?.status === 'closing') && secureChat.unlocked) {
    actions.push({
      key: 'lock',
      label: '锁定会话',
      onClick: () => runSecureAction(onLockSecureChat)
    });
  }
  if (secureChat?.status === 'enabled') {
    actions.push({
      key: 'request-close',
      label: '申请关闭',
      variant: 'danger',
      onClick: () => runSecureAction(onRequestCloseSecureChat)
    });
  }
  if (secureChat?.status === 'closing' && secureChat.closeRequestedByMe) {
    actions.push({
      key: 'cancel-close',
      label: '取消关闭申请',
      onClick: () => runSecureAction(onCancelCloseSecureChat)
    });
  }
  if (secureChat?.status === 'closing' && !secureChat.closeRequestedByMe) {
    actions.push({
      key: 'confirm-close',
      label: '确认关闭',
      variant: 'danger',
      onClick: () => runSecureAction(onConfirmCloseSecureChat)
    });
    actions.push({
      key: 'reject-close',
      label: '拒绝关闭',
      onClick: () => runSecureAction(onCancelCloseSecureChat)
    });
  }
  if (secureChat?.status === 'waiting_peer') {
    actions.push({
      key: 'cancel-invite',
      label: '取消邀请',
      variant: 'danger',
      onClick: () => runSecureAction(onCancelSecureInvite)
    });
  }

  return (
    <aside className="planner-drawer secure-drawer" aria-label="安全聊天">
      <div className="planner-drawer-header">
        <div className="planner-avatar-pair" aria-hidden="true">
          <span>安</span>
          <span>{(contact?.displayName || 'Ta').slice(0, 1)}</span>
        </div>
        <div className="planner-drawer-title">
          <h2>安全聊天</h2>
          <p>当前状态：{statusText}</p>
        </div>
        {onClose && (
          <button type="button" className="planner-close-button" onClick={onClose} aria-label="收回安全设置">
            收回
          </button>
        )}
      </div>

      <div className="planner-drawer-controls secure-drawer-summary">
        <p>
          邀请对方同意后，双方用各自的登录密码保护会话密钥。服务器只存密文。关闭需双方确认，历史密钥会保留。
        </p>
        {!secureChatSupported && (
          <p className="secure-chat-warning">需要 HTTPS 才能使用安全聊天。</p>
        )}
      </div>

      <div className="planner-drawer-list secure-drawer-actions">
        {actions.length === 0 ? (
          <div className="planner-drawer-empty">当前没有可执行的操作。</div>
        ) : (
          actions.map((action) => (
            <button
              type="button"
              key={action.key}
              className={cls(
                'secure-drawer-action',
                action.variant === 'primary' && 'primary',
                action.variant === 'danger' && 'danger'
              )}
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))
        )}
      </div>
    </aside>
  );
}


export { SecureChatPanel };
