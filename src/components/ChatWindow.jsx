'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { Textarea } from '../../components/ui/textarea.jsx';
import { Button, emojiGroups, resolveBubbleTheme, resolveChatBg } from '../lib/ui.jsx';
import { readImageFile } from '../lib/media.js';
import { Avatar } from './Avatar.jsx';
import { Twemoji, renderTwemojiText } from './Twemoji.jsx';
import { CouplePlannerPanel } from './CouplePlannerPanel.jsx';
import { CoupleMomentsPanel } from './CoupleMomentsPanel.jsx';
import { SecureChatPanel } from './SecureChatPanel.jsx';

function ChatWindow({
  contact,
  messages,
  self,
  stickers,
  chatBgPreset = 'soft',
  chatBgDataUrl = '',
  hasOlderMessages,
  loadingOlderMessages,
  onLoadOlderMessages,
  onSend,
  onSendSticker,
  onAddSticker,
  onDeleteStickers,
  onRecall,
  secureChat,
  secureChatSupported,
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
  onBack
}) {
  const [text, setText] = useState('');
  const [quote, setQuote] = useState(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [stickerBusy, setStickerBusy] = useState(false);
  const [stickerManage, setStickerManage] = useState(false);
  const [selectedStickerIds, setSelectedStickerIds] = useState([]);
  const [savingStickerMessageIds, setSavingStickerMessageIds] = useState([]);
  const [sideTool, setSideTool] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState('chat');
  const [plannerTasks, setPlannerTasks] = useState([]);
  const [moments, setMoments] = useState([]);
  const bottomRef = useRef(null);
  const streamRef = useRef(null);
  const textareaRef = useRef(null);
  const messageRefs = useRef(new Map());
  const isNearBottomRef = useRef(true);
  const previousContactIdRef = useRef(null);
  const pendingScrollToBottomRef = useRef(false);
  const previousMessagesRef = useRef([]);
  const preserveScrollRef = useRef(null);

  useLayoutEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const previousMessages = previousMessagesRef.current;
    const contactChanged = previousContactIdRef.current !== contact?.id;
    const firstChanged = previousMessages[0]?.id !== messages[0]?.id;
    const lastChanged = previousMessages.at(-1)?.id !== messages.at(-1)?.id;
    const prependedHistory = !contactChanged && firstChanged && previousMessages.length > 0 && messages.at(-1)?.id === previousMessages.at(-1)?.id;

    if (prependedHistory && preserveScrollRef.current) {
      const { scrollHeight, scrollTop } = preserveScrollRef.current;
      stream.scrollTop = stream.scrollHeight - scrollHeight + scrollTop;
    } else if (contactChanged || previousMessages.length === 0) {
      stream.scrollTop = stream.scrollHeight;
      isNearBottomRef.current = true;
    } else if (pendingScrollToBottomRef.current || (lastChanged && isNearBottomRef.current)) {
      stream.scrollTop = stream.scrollHeight;
    }

    previousContactIdRef.current = contact?.id || null;
    previousMessagesRef.current = messages;
    pendingScrollToBottomRef.current = false;
    preserveScrollRef.current = null;
  }, [messages, contact?.id]);

  useEffect(() => {
    setQuote(null);
    setProfileOpen(false);
    setMobilePane('chat');
    setSideTool(null);
  }, [contact?.id]);

  useEffect(() => {
    if (!stickerOpen) {
      setStickerManage(false);
      setSelectedStickerIds([]);
    }
  }, [stickerOpen]);

  useEffect(() => {
    setEmojiOpen(false);
    setStickerOpen(false);
  }, [contact?.id]);

  useEffect(() => {
    if (!contact || !self) {
      setPlannerTasks([]);
      return;
    }
    let active = true;
    setPlannerTasks([]);
    api.plannerTasks(contact.id)
      .then((data) => {
        if (active) setPlannerTasks(data.tasks);
      })
      .catch((err) => {
        if (active) alert(err.message);
      });
    return () => {
      active = false;
    };
  }, [contact?.id, self?.id]);

  useEffect(() => {
    if (!contact || !self) {
      setMoments([]);
      return;
    }
    let active = true;
    setMoments([]);
    api.moments(contact.id)
      .then((data) => {
        if (active) setMoments(data.moments);
      })
      .catch((err) => {
        if (active) alert(err.message);
      });
    return () => {
      active = false;
    };
  }, [contact?.id, self?.id]);

  function replacePlannerTask(task) {
    setPlannerTasks((current) => current.map((item) => (item.id === task.id ? task : item)));
  }

  async function addPlannerTask(task) {
    if (!contact) return;
    try {
      const data = await api.addPlannerTask(contact.id, task);
      setPlannerTasks((current) => [data.task, ...current.filter((item) => item.id !== data.task.id)]);
      setSideTool('planner');
      setMobilePane('planner');
    } catch (err) {
      alert(err.message);
      throw err;
    }
  }

  async function updatePlannerTask(taskId, patch) {
    try {
      if (Object.hasOwn(patch, 'confirmedByA')) {
        const data = await api.confirmPlannerTask(taskId, patch.confirmedByA);
        replacePlannerTask(data.task);
        return;
      }
      const data = await api.updatePlannerTask(taskId, patch);
      replacePlannerTask(data.task);
    } catch (err) {
      alert(err.message);
    }
  }

  async function deletePlannerTask(taskId) {
    try {
      await api.deletePlannerTask(taskId);
      setPlannerTasks((current) => current.filter((task) => task.id !== taskId));
    } catch (err) {
      alert(err.message);
    }
  }

  async function reloadPlannerTasks() {
    if (!contact || !self) {
      setPlannerTasks([]);
      return;
    }
    try {
      const data = await api.plannerTasks(contact.id);
      setPlannerTasks(data.tasks);
    } catch (err) {
      alert(err.message);
    }
  }

  async function reloadMoments() {
    if (!contact || !self) {
      setMoments([]);
      return;
    }
    try {
      const data = await api.moments(contact.id);
      setMoments(data.moments);
    } catch (err) {
      alert(err.message);
    }
  }

  async function addMoment(payload) {
    if (!contact) return;
    const data = await api.addMoment(contact.id, payload);
    setMoments(data.moments);
    setSideTool('moments');
    setMobilePane('moments');
  }

  async function updateMoment(momentId, payload) {
    const data = await api.updateMoment(momentId, payload);
    setMoments(data.moments);
  }

  async function deleteMoment(momentId) {
    await api.deleteMoment(momentId);
    setMoments((current) => current.filter((moment) => moment.id !== momentId));
  }

  async function submit(event) {
    event.preventDefault();
    const content = text.trim();
    if (!content || !contact) return;
    if (secureChat?.status !== 'off' && !secureChat.unlocked) {
      await onUnlockSecureChat?.();
      return;
    }
    const currentQuote = quote;
    setText('');
    setQuote(null);
    pendingScrollToBottomRef.current = true;
    try {
      await onSend(content, currentQuote?.id || '');
    } catch (err) {
      pendingScrollToBottomRef.current = false;
      setText(content);
      setQuote(currentQuote);
      alert(err.message);
    }
  }

  function insertLineBreak(event) {
    event.preventDefault();
    const textarea = event.currentTarget;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const nextText = `${textarea.value.slice(0, start)}\n${textarea.value.slice(end)}`;
    setText(nextText);
    requestAnimationFrame(() => {
      textarea.setSelectionRange(start + 1, start + 1);
    });
  }

  function insertEmoji(emoji) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? text.length;
    const end = textarea?.selectionEnd ?? text.length;
    const nextText = `${text.slice(0, start)}${emoji}${text.slice(end)}`;
    const nextPosition = start + emoji.length;
    setText(nextText);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextPosition, nextPosition);
    });
  }

  function updateScrollPosition(event) {
    const node = event.currentTarget;
    const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    isNearBottomRef.current = distanceToBottom < 80;
    if (node.scrollTop < 80 && hasOlderMessages && !loadingOlderMessages) {
      preserveScrollRef.current = {
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop
      };
      onLoadOlderMessages?.();
    }
  }

  function handleWheel(event) {
    if (event.deltaY < 0) {
      isNearBottomRef.current = false;
    }
  }

  function scrollToMessage(messageId) {
    const node = messageRefs.current.get(messageId);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.classList.add('message-highlight');
    window.setTimeout(() => node.classList.remove('message-highlight'), 900);
  }

  function quoteMessage(message) {
    setQuote(message);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }

  function renderQuote(quoted, interactive = false) {
    if (!quoted) return null;
    const quotedSticker = quoted.kind === 'sticker' && quoted.sticker;
    return (
      <button
        type="button"
        className={`quote-card ${interactive ? 'quote-link' : ''}`}
        onClick={interactive ? () => scrollToMessage(quoted.id) : undefined}
      >
        <strong>{quoted.authorName || (quoted.fromId === self.id ? self.displayName : contact.displayName)}</strong>
        {quoted.recalledAt ? (
          <span>消息已撤回</span>
        ) : quotedSticker ? (
          <span className="quote-sticker-line">
            <img src={quoted.sticker.imageDataUrl} alt="表情包" />
          </span>
        ) : (
          <span>{renderTwemojiText(quoted.text)}</span>
        )}
      </button>
    );
  }

  function getBubblePreset(themeId) {
    return resolveBubbleTheme(themeId);
  }

  function getMessageBubbleStyle(preset, transparent = false) {
    if (transparent) {
      return {
        background: 'transparent',
        borderColor: 'transparent',
        boxShadow: 'none'
      };
    }
    return {
      '--bubble-start': preset.start,
      '--bubble-end': preset.end,
      '--bubble-shadow': preset.shadow,
      background: `linear-gradient(135deg, ${preset.start}, ${preset.end})`,
      borderColor: 'transparent',
      boxShadow: `0 10px 26px ${preset.shadow}`
    };
  }

  function hasSavedSticker(sticker) {
    return Boolean(sticker?.imageDataUrl && stickers.some((item) => item.imageDataUrl === sticker.imageDataUrl));
  }

  async function addStickerFromMessage(message) {
    if (!message.sticker || hasSavedSticker(message.sticker) || savingStickerMessageIds.includes(message.id)) return;
    setSavingStickerMessageIds((ids) => [...ids, message.id]);
    try {
      await onAddSticker({
        name: message.sticker.name || '表情包',
        imageDataUrl: message.sticker.imageDataUrl
      });
      setStickerOpen(true);
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingStickerMessageIds((ids) => ids.filter((id) => id !== message.id));
    }
  }

  async function recall(message) {
    const ok = window.confirm('确定撤回这条消息吗？');
    if (!ok) return;
    try {
      await onRecall(message.id);
      if (quote?.id === message.id) setQuote(null);
    } catch (err) {
      alert(err.message);
    }
  }

  async function importSticker(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setStickerBusy(true);
    try {
      const imageDataUrl = await readImageFile(file);
      await onAddSticker({
        name: file.name.replace(/\.[^.]+$/, ''),
        imageDataUrl
      });
      setStickerOpen(true);
    } catch (err) {
      alert(err.message);
    } finally {
      setStickerBusy(false);
    }
  }

  async function sendSticker(sticker) {
    if (!contact) return;
    const currentQuote = quote;
    setQuote(null);
    setStickerOpen(false);
    pendingScrollToBottomRef.current = true;
    try {
      await onSendSticker(sticker.id, currentQuote?.id || '');
    } catch (err) {
      pendingScrollToBottomRef.current = false;
      setQuote(currentQuote);
      alert(err.message);
    }
  }

  function toggleStickerSelection(stickerId) {
    setSelectedStickerIds((ids) =>
      ids.includes(stickerId) ? ids.filter((id) => id !== stickerId) : [...ids, stickerId]
    );
  }

  async function deleteSelectedStickers() {
    if (selectedStickerIds.length === 0) return;
    const ok = window.confirm(`确定删除选中的 ${selectedStickerIds.length} 个表情包吗？`);
    if (!ok) return;
    try {
      await onDeleteStickers(selectedStickerIds);
      setSelectedStickerIds([]);
      setStickerManage(false);
    } catch (err) {
      alert(err.message);
    }
  }

  if (!contact) {
    return (
      <section className="chat-empty">
        <div className="empty-orbit">聊</div>
        <h2>选择一个联系人开始聊天</h2>
        <p>添加用户后即可发送私聊消息，聊天记录会保存在后台文件中。</p>
      </section>
    );
  }

  const activePlannerCount = plannerTasks.filter((task) => !task.done).length;
  function closeSideTool() {
    setSideTool(null);
    setMobilePane('chat');
  }

  function renderPlanner() {
    return (
      <CouplePlannerPanel
        tasks={plannerTasks}
        selfLabel="你"
        contactLabel={contact.displayName.slice(0, 1) || 'Ta'}
        onAddTask={addPlannerTask}
        onUpdateTask={updatePlannerTask}
        onDeleteTask={deletePlannerTask}
        onClose={closeSideTool}
      />
    );
  }

  function renderMoments() {
    return (
      <CoupleMomentsPanel
        moments={moments}
        self={self}
        contact={contact}
        onAddMoment={addMoment}
        onUpdateMoment={updateMoment}
        onDeleteMoment={deleteMoment}
        onClose={closeSideTool}
      />
    );
  }

  function renderSecure() {
    return (
      <SecureChatPanel
        secureChat={secureChat}
        secureChatSupported={secureChatSupported}
        contact={contact}
        onEnableSecureChat={onEnableSecureChat}
        onUnlockSecureChat={onUnlockSecureChat}
        onLockSecureChat={onLockSecureChat}
        onAcceptSecureInvite={onAcceptSecureInvite}
        onCompleteSecureInvite={onCompleteSecureInvite}
        onRequestCloseSecureChat={onRequestCloseSecureChat}
        onConfirmCloseSecureChat={onConfirmCloseSecureChat}
        onCancelCloseSecureChat={onCancelCloseSecureChat}
        onCancelSecureInvite={onCancelSecureInvite}
        onUnlockSecureHistory={onUnlockSecureHistory}
        onClose={closeSideTool}
      />
    );
  }

  function renderSideTool() {
    if (sideTool === 'secure' || mobilePane === 'secure') return renderSecure();
    if (sideTool === 'moments' || mobilePane === 'moments') return renderMoments();
    return renderPlanner();
  }

  // Only nudge when the user must act — avoid a permanent status strip over the chat.
  const secureStatusLabel = !secureChat
    ? ''
    : secureChat.status === 'enabled' && !secureChat.unlocked
      ? '安全聊天已锁住，输入密码后继续'
      : secureChat.status === 'closing'
        ? (secureChat.closeRequestedByMe ? '已申请关闭，等待对方同意' : '对方申请关闭安全聊天')
        : secureChat.status === 'waiting_peer'
          ? (secureChat.isInitiator
            ? (secureChat.peerAccepted ? '对方已同意，请完成开启' : '等待对方同意开启')
            : (secureChat.peerAccepted ? '已同意，等待对方完成' : '收到安全聊天邀请'))
          : '';

  const secureBannerVisible = Boolean(secureStatusLabel) && sideTool !== 'secure' && mobilePane !== 'secure';
  const secureActive = secureChat?.status === 'enabled' || secureChat?.status === 'closing' || secureChat?.status === 'waiting_peer';
  const chatBackground = resolveChatBg(chatBgPreset, chatBgDataUrl);
  const chatPanelStyle = chatBackground.imageUrl
    ? {
        backgroundColor: '#eaf8f5',
        backgroundImage: `linear-gradient(180deg, rgba(255,255,255,0.42), rgba(255,255,255,0.55)), url(${chatBackground.imageUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }
    : {
        backgroundImage: 'none',
        background: chatBackground.css
      };


  return (
    <section className={`chat-panel ${sideTool ? 'planner-open' : ''}`} style={chatPanelStyle}>
      <div className={`chat-core ${mobilePane !== 'chat' ? 'mobile-planner-active' : ''} ${secureBannerVisible ? 'has-secure-banner' : ''}`}>
        <header className="chat-header">
          <button type="button" className="mobile-back-button" onClick={onBack} aria-label="返回联系人">
            返回
          </button>
          <button type="button" className="chat-profile-button" onClick={() => setProfileOpen(true)} aria-label="查看联系人简介">
            <Avatar user={contact} />
          </button>
          <div className="chat-header-copy">
            <h2>{contact.displayName}</h2>
            <span>@{contact.username}</span>
          </div>
          <button
            type="button"
            className={`planner-header-button ${sideTool === 'planner' ? 'active' : ''}`}
            onClick={() => {
              setSideTool((tool) => {
                const next = tool === 'planner' ? null : 'planner';
                if (next === 'planner') void reloadPlannerTasks();
                return next;
              });
              setMobilePane('planner');
            }}
          >
            待办 {activePlannerCount}
          </button>
          <button
            type="button"
            className={`planner-header-button ${sideTool === 'moments' ? 'active' : ''}`}
            onClick={() => {
              setSideTool((tool) => {
                const next = tool === 'moments' ? null : 'moments';
                if (next === 'moments') void reloadMoments();
                return next;
              });
              setMobilePane('moments');
            }}
          >
            回忆 {moments.length}
          </button>
          <button
            type="button"
            className={`planner-header-button ${sideTool === 'secure' ? 'active' : ''} ${secureActive ? 'secure-on' : ''}`}
            onClick={() => {
              setSideTool((tool) => (tool === 'secure' ? null : 'secure'));
              setMobilePane((pane) => (pane === 'secure' ? 'chat' : 'secure'));
            }}
          >
            安全
          </button>
        </header>
        {secureBannerVisible && (
          <button
            type="button"
            className="secure-chat-banner"
            onClick={() => {
              setSideTool('secure');
              setMobilePane('secure');
            }}
          >
            {secureStatusLabel}
          </button>
        )}
        {profileOpen && (
          <div className="profile-dialog-backdrop" role="presentation" onClick={() => setProfileOpen(false)}>
            <section
              className="contact-profile-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="联系人资料"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="contact-profile-head">
                <Avatar user={contact} />
                <div>
                  <h3>{contact.displayName}</h3>
                  <span>@{contact.username}</span>
                </div>
              </div>
              <div className="contact-profile-bio">
                <span>个人简介</span>
                <p>{contact.bio || '还没有填写简介'}</p>
              </div>
              <button type="button" onClick={() => setProfileOpen(false)}>关闭</button>
            </section>
          </div>
        )}

        <div className="mobile-chat-tabs" aria-label="聊天视图切换">
          <button type="button" className={mobilePane === 'chat' ? 'active' : ''} onClick={() => setMobilePane('chat')}>
            聊天
          </button>
          <button
            type="button"
            className={mobilePane === 'planner' ? 'active' : ''}
            onClick={() => {
              void reloadPlannerTasks();
              setSideTool('planner');
              setMobilePane('planner');
            }}
          >
            待办 {activePlannerCount}
          </button>
          <button
            type="button"
            className={mobilePane === 'moments' ? 'active' : ''}
            onClick={() => {
              void reloadMoments();
              setSideTool('moments');
              setMobilePane('moments');
            }}
          >
            回忆 {moments.length}
          </button>
          <button
            type="button"
            className={mobilePane === 'secure' ? 'active' : ''}
            onClick={() => {
              setSideTool('secure');
              setMobilePane('secure');
            }}
          >
            安全
          </button>
        </div>

        <div className="chat-mobile-planner">{renderSideTool()}</div>

        <div className="message-stream" ref={streamRef} onScroll={updateScrollPosition} onWheel={handleWheel}>
          {(hasOlderMessages || loadingOlderMessages) && (
            <div className="message-history-loader">
              {loadingOlderMessages ? '正在加载更早消息...' : '向上滚动加载更早消息'}
            </div>
          )}
          {messages.map((message) => {
            const mine = message.fromId === self.id;
            const sender = mine ? self : contact;
            const bubblePreset = getBubblePreset(sender?.bubbleTheme);
            const recalled = Boolean(message.recalledAt);
            const stickerBubble = message.kind === 'sticker' && !recalled;
            const canAddSticker = stickerBubble && !mine && message.sticker;
            const stickerSaved = canAddSticker && hasSavedSticker(message.sticker);
            const savingSticker = savingStickerMessageIds.includes(message.id);
            const canRecall = mine && !recalled && !message.ciphertext && Date.now() - new Date(message.createdAt).getTime() <= 8 * 60 * 1000;
            return (
              <div
                key={message.id}
                className={`message-row ${mine ? 'mine' : ''}`}
                ref={(node) => {
                  if (node) messageRefs.current.set(message.id, node);
                  else messageRefs.current.delete(message.id);
                }}
              >
                {!mine && <Avatar user={contact} size="tiny" />}
                <div
                  className={`message-bubble ${stickerBubble ? 'sticker-bubble' : ''}`}
                  style={getMessageBubbleStyle(bubblePreset, stickerBubble)}
                >
                  <div>
                    {recalled ? (
                      <p className="message-recalled">消息已撤回</p>
                    ) : (
                      <>
                        {renderQuote(message.quote, true)}
                        {message.kind === 'sticker' && message.sticker ? (
                          <img className="message-sticker" src={message.sticker.imageDataUrl} alt={message.sticker.name || '表情包'} />
                        ) : (
                          <p>{renderTwemojiText(message.text)}</p>
                        )}
                      </>
                    )}
                    <div className="message-meta">
                      {!recalled && <button type="button" onClick={() => quoteMessage(message)}>引用</button>}
                      {canAddSticker && (
                        stickerSaved ? (
                          <span className="sticker-saved-state">已添加</span>
                        ) : (
                          <button type="button" onClick={() => addStickerFromMessage(message)} disabled={savingSticker}>
                            {savingSticker ? '添加中' : '添加表情'}
                          </button>
                        )
                      )}
                      {canRecall && <button type="button" onClick={() => recall(message)}>撤回</button>}
                      {mine && <span className="read-state">{message.readAt ? '已读' : '未读'}</span>}
                      <time>{new Date(message.createdAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>
                    </div>
                  </div>
                </div>
                {mine && <Avatar user={self} size="tiny" />}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <form className="composer" onSubmit={submit}>
          <div className="composer-main">
            {quote && (
              <div className="composer-quote">
                {renderQuote(quote)}
                <button type="button" onClick={() => setQuote(null)}>取消引用</button>
              </div>
            )}
            <div className="composer-input-box">
              <Textarea
                ref={textareaRef}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={secureChat?.status !== 'off' && !secureChat.unlocked ? '输入密码解锁后即可发送' : `发送给 ${contact.displayName}`}
                disabled={secureChat?.status !== 'off' && !secureChat.unlocked}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && event.ctrlKey) {
                    insertLineBreak(event);
                    return;
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submit(event);
                  }
                }}
              />
              <div className="sticker-toolbar">
                <button
                  type="button"
                  className={emojiOpen ? 'active' : ''}
                  onClick={() => {
                    setEmojiOpen((open) => !open);
                    setStickerOpen(false);
                  }}
                  title="Emoji"
                >
                  <Twemoji emoji="😀" className="toolbar-icon" />
                </button>
                <button
                  type="button"
                  className={stickerOpen ? 'active' : ''}
                  onClick={() => {
                    setStickerOpen((open) => !open);
                    setEmojiOpen(false);
                  }}
                  title="表情包"
                >
                  <Twemoji emoji="❤️" className="toolbar-icon" />
                </button>
              </div>
            </div>
          </div>
          <Button type="submit" variant="primary" className="send-button" title="发送消息">发送</Button>
          {emojiOpen && (
            <div className="emoji-panel">
              {emojiGroups.map((group) => (
                <section className="emoji-group" key={group.id}>
                  <h3>{group.name}</h3>
                  <div className="emoji-grid">
                    {group.items.map((emoji) => (
                      <button type="button" key={emoji} onClick={() => insertEmoji(emoji)} title={emoji}>
                        <Twemoji emoji={emoji} className="emoji-option" />
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
          {stickerOpen && (
            <div className="sticker-panel">
              <div className="sticker-panel-header">
                <span>{stickerManage ? `已选择 ${selectedStickerIds.length}` : '我的表情'}</span>
                <div>
                  {stickerManage && (
                    <button type="button" className="danger-link" onClick={deleteSelectedStickers} disabled={selectedStickerIds.length === 0}>
                      删除
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setStickerManage((manage) => !manage);
                      setSelectedStickerIds([]);
                    }}
                    disabled={stickers.length === 0}
                  >
                    {stickerManage ? '完成' : '管理'}
                  </button>
                </div>
              </div>
              <div className="sticker-grid">
                {!stickerManage && (
                  <label className="sticker-import">
                    <span>+</span>
                    <input type="file" accept="image/*" onChange={importSticker} disabled={stickerBusy} />
                  </label>
                )}
                {stickers.map((sticker) => {
                  const selected = selectedStickerIds.includes(sticker.id);
                  return (
                    <button
                      type="button"
                      key={sticker.id}
                      className={selected ? 'selected' : ''}
                      onClick={() => (stickerManage ? toggleStickerSelection(sticker.id) : sendSticker(sticker))}
                      title={sticker.name}
                    >
                      <img src={sticker.imageDataUrl} alt={sticker.name} />
                      {stickerManage && <span className="sticker-check">{selected ? '✓' : ''}</span>}
                    </button>
                  );
                })}
                {stickers.length === 0 && <div className="sticker-empty">导入图片后可作为表情发送</div>}
              </div>
            </div>
          )}
        </form>
      </div>
      <div className="chat-desktop-planner">
        {sideTool === 'secure' ? renderSecure() : sideTool === 'moments' ? renderMoments() : renderPlanner()}
      </div>
    </section>
  );
}


export { ChatWindow };
