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
      alert(err?.message || '操作没成功，请稍后再试。');
    }
  }

  const statusText = !secureChat
    ? '未开启'
    : secureChat.status === 'enabled'
      ? (secureChat.unlocked ? '进行中，可正常聊天' : '已锁住，输入密码后继续')
      : secureChat.status === 'closing'
        ? (secureChat.closeRequestedByMe ? '你已申请关闭，等待对方确认' : '对方想关闭，请你确认')
        : secureChat.status === 'waiting_peer'
          ? (secureChat.isInitiator
            ? (secureChat.peerAccepted ? '对方已同意，请点下方完成开启' : '已发出邀请，等待对方同意')
            : (secureChat.peerAccepted ? '你已同意，等待对方完成开启' : '收到邀请，可同意开启'))
          : (secureChat.hasHistoricalKeys
            ? (secureChat.historyUnlocked ? '已关闭，旧消息可查看' : '已关闭，旧消息需解锁后查看')
            : '未开启');

  const helpText = !secureChat || secureChat.status === 'off'
    ? (secureChat?.hasHistoricalKeys
      ? '开启后，聊天文字将加密存储。需要双方同意才能开启。\n你们曾开通过，可用开启时的登录密码再次查看旧消息。'
      : '开启后，聊天文字将加密存储。需要双方同意才能开启。')
    : secureChat.status === 'waiting_peer'
      ? (secureChat.isInitiator
        ? (secureChat.peerAccepted
          ? '对方已同意。点下方完成开启后，聊天文字将开始加密存储。'
          : '邀请已发出。需要对方也同意后才能开启。')
        : (secureChat.peerAccepted
          ? '你已同意，等待对方完成开启。'
          : '对方邀请开启安全聊天。同意后，聊天文字将加密存储。'))
      : secureChat.status === 'enabled'
        ? (secureChat.unlocked
          ? '聊天文字正在加密存储。关闭也需要双方同意；也可先暂时锁定。'
          : '安全聊天已开启。输入登录密码后即可继续查看和发送。')
        : secureChat.status === 'closing'
          ? (secureChat.closeRequestedByMe
            ? '你已申请关闭，等待对方同意。'
            : '对方申请关闭。同意后回到普通聊天；旧消息仍可加密保存，可用开启时的密码查看。')
          : '开启后，聊天文字将加密存储。需要双方同意才能开启。';

  const actions = [];
  if (secureChat?.status === 'off') {
    actions.push({
      key: 'invite',
      label: '邀请对方开启',
      variant: 'primary',
      disabled: !secureChatSupported,
      onClick: () => runSecureAction(onEnableSecureChat)
    });
  }
  if (secureChat?.canUnlockHistory) {
    actions.push({
      key: 'unlock-history',
      label: '查看以前的加密聊天',
      disabled: !secureChatSupported,
      onClick: () => runSecureAction(onUnlockSecureHistory)
    });
  }
  if (secureChat?.status === 'off' && secureChat.historyUnlocked && !secureChat.canUnlockHistory) {
    actions.push({
      key: 'lock-history',
      label: '重新隐藏旧消息',
      onClick: () => runSecureAction(onLockSecureChat)
    });
  }
  if (secureChat?.canAcceptInvite) {
    actions.push({
      key: 'accept',
      label: '同意开启',
      variant: 'primary',
      disabled: !secureChatSupported,
      onClick: () => runSecureAction(onAcceptSecureInvite)
    });
  }
  if (secureChat?.canCompleteInvite) {
    actions.push({
      key: 'complete',
      label: '完成开启',
      variant: 'primary',
      disabled: !secureChatSupported,
      onClick: () => runSecureAction(onCompleteSecureInvite)
    });
  }
  if ((secureChat?.status === 'enabled' || secureChat?.status === 'closing') && !secureChat.unlocked && secureChat.hasUserWrappedKey) {
    actions.push({
      key: 'unlock',
      label: '输入密码继续',
      variant: 'primary',
      disabled: !secureChatSupported,
      onClick: () => runSecureAction(onUnlockSecureChat)
    });
  }
  if ((secureChat?.status === 'enabled' || secureChat?.status === 'closing') && secureChat.unlocked) {
    actions.push({
      key: 'lock',
      label: '暂时锁定',
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
      label: '撤回关闭申请',
      onClick: () => runSecureAction(onCancelCloseSecureChat)
    });
  }
  if (secureChat?.status === 'closing' && !secureChat.closeRequestedByMe) {
    actions.push({
      key: 'confirm-close',
      label: '同意关闭',
      variant: 'danger',
      onClick: () => runSecureAction(onConfirmCloseSecureChat)
    });
    actions.push({
      key: 'reject-close',
      label: '暂不关闭',
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
          <p>当前：{statusText}</p>
        </div>
        {onClose && (
          <button type="button" className="planner-close-button" onClick={onClose} aria-label="收回安全设置">
            收回
          </button>
        )}
      </div>

      <div className="planner-drawer-controls secure-drawer-summary">
        <p>{helpText}</p>
        {!secureChatSupported && (
          <p className="secure-chat-warning">需要用 https 打开本站，才能使用安全聊天。</p>
        )}
      </div>

      <div className="planner-drawer-list secure-drawer-actions">
        {actions.length === 0 ? (
          <div className="planner-drawer-empty">暂时没有需要你处理的步骤。</div>
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
