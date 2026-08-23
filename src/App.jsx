'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  assertSecureChatSupported,
  base64,
  defaultKdfParameters,
  decryptMessage,
  deriveLoginKek,
  deriveSharedRootKey,
  encryptMessage,
  fromBase64,
  generateEcdhKeyPair,
  isSecureChatSupported,
  makeConversationId,
  randomSalt,
  secureCryptoVersion,
  unwrapBytes,
  unwrapRootKey,
  wrapBytes,
  wrapRootKey
} from './secure-crypto.js';
import { api } from './api/client.js';
import { messagePageSize, useMobileShell } from './lib/ui.jsx';
import { AuthPanel } from './components/AuthPanel.jsx';
import { AdminPanel } from './components/AdminPanel.jsx';
import { ContactList } from './components/ContactList.jsx';
import { ChatWindow } from './components/ChatWindow.jsx';
import { SecureInputDialog } from './components/SecureInputDialog.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [stickers, setStickers] = useState([]);
  const [secureChat, setSecureChat] = useState({ status: 'off', unlocked: false });
  const [secureChatSupported, setSecureChatSupported] = useState(false);
  const [secureInputDialog, setSecureInputDialog] = useState(null);
  const secureInputResolverRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  const selectedId = selected?.id;
  const messagesRef = useRef([]);
  // Per-conversation unlocked roots for this browser tab (also mirrored to sessionStorage).
  const secureRootsByConversationRef = useRef({});
  const secureMaterialRef = useRef(null);
  const loadingOlderMessagesRef = useRef(false);
  const hasOlderMessagesRef = useRef(false);
  const originalTitleRef = useRef('doolulu');
  const isMobileShell = useMobileShell();
  const SECURE_ROOTS_STORAGE_KEY = 'doolulu.secureRoots.v1';

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    setSecureChatSupported(isSecureChatSupported());
  }, []);

  useEffect(() => {
    loadingOlderMessagesRef.current = loadingOlderMessages;
  }, [loadingOlderMessages]);

  useEffect(() => {
    hasOlderMessagesRef.current = hasOlderMessages;
  }, [hasOlderMessages]);

  function clearSession() {
    localStorage.removeItem('doolulu.token');
    clearSecureRoots();
    secureMaterialRef.current = null;
    setSecureChat({ status: 'off', unlocked: false });
    setUser(null);
    setSelected(null);
    setMessages([]);
    setHasOlderMessages(false);
    setStickers([]);
    setContacts([]);
  }

  async function refreshContacts() {
    const data = await api.contacts();
    setContacts(data.contacts);
    if (selectedId) {
      const fresh = data.contacts.find((item) => item.id === selectedId);
      if (fresh) setSelected(fresh);
    }
  }

  function mergeMessages(current, incoming) {
    const byId = new Map(current.map((message) => [message.id, message]));
    for (const message of incoming) byId.set(message.id, message);
    return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  function isSecureLive(status = secureChat.status) {
    return status === 'enabled' || status === 'closing' || status === 'waiting_peer';
  }

  function activeSecureConversationId(contactId = selectedId) {
    return (
      secureMaterialRef.current?.conversation?.conversationId
      || (user && contactId ? makeConversationId(user.id, contactId) : '')
    );
  }

  function getRootsByVersion(conversationId = activeSecureConversationId()) {
    if (!conversationId) return {};
    return secureRootsByConversationRef.current[conversationId] || {};
  }

  function persistSecureRoots(userId = user?.id) {
    if (!userId || typeof sessionStorage === 'undefined') return;
    try {
      const conversations = {};
      for (const [conversationId, roots] of Object.entries(secureRootsByConversationRef.current)) {
        const encoded = {};
        for (const [version, rootKey] of Object.entries(roots)) {
          if (rootKey) encoded[version] = base64(rootKey);
        }
        if (Object.keys(encoded).length) conversations[conversationId] = encoded;
      }
      if (!Object.keys(conversations).length) {
        sessionStorage.removeItem(SECURE_ROOTS_STORAGE_KEY);
        return;
      }
      sessionStorage.setItem(SECURE_ROOTS_STORAGE_KEY, JSON.stringify({ userId, conversations }));
    } catch {
      // Private mode / quota — ignore; in-memory unlock still works.
    }
  }

  function hydrateSecureRoots(userId) {
    if (!userId || typeof sessionStorage === 'undefined') return;
    try {
      const raw = sessionStorage.getItem(SECURE_ROOTS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.userId !== userId || !parsed.conversations) {
        sessionStorage.removeItem(SECURE_ROOTS_STORAGE_KEY);
        return;
      }
      const next = {};
      for (const [conversationId, roots] of Object.entries(parsed.conversations)) {
        next[conversationId] = {};
        for (const [version, value] of Object.entries(roots || {})) {
          next[conversationId][Number(version)] = fromBase64(value);
        }
      }
      secureRootsByConversationRef.current = next;
    } catch {
      sessionStorage.removeItem(SECURE_ROOTS_STORAGE_KEY);
    }
  }

  function setSecureRoots(conversationId, rootsByVersion) {
    if (!conversationId) return;
    secureRootsByConversationRef.current = {
      ...secureRootsByConversationRef.current,
      [conversationId]: { ...rootsByVersion }
    };
    persistSecureRoots();
  }

  function clearSecureRoots(conversationId = null) {
    if (conversationId) {
      const next = { ...secureRootsByConversationRef.current };
      delete next[conversationId];
      secureRootsByConversationRef.current = next;
    } else {
      secureRootsByConversationRef.current = {};
    }
    persistSecureRoots(user?.id);
    if (!conversationId && typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(SECURE_ROOTS_STORAGE_KEY);
    }
  }

  function shouldLoadEncryptedMessages(material = secureMaterialRef.current) {
    const status = material?.conversation?.status || secureChat.status || 'off';
    return isSecureLive(status) || Boolean(material?.hasHistoricalKeys);
  }

  async function fetchMergedMessages(contactId, params = {}, material = secureMaterialRef.current) {
    const plain = await api.messages(contactId, { ...params, limit: messagePageSize });
    let encrypted = { messages: [], hasMore: false };
    if (shouldLoadEncryptedMessages(material)) {
      encrypted = await api.encryptedMessages(contactId, { ...params, limit: messagePageSize });
    }
    const decrypted = await decryptEncryptedMessages(encrypted.messages);
    return {
      messages: mergeMessages(plain.messages, decrypted),
      hasMore: Boolean(plain.hasMore || encrypted.hasMore)
    };
  }

  async function loadLatestMessages(contactId = selectedId) {
    if (!contactId) return;
    const material = await loadSecureMaterial(contactId);
    const merged = await fetchMergedMessages(contactId, {}, material);
    setMessages(merged.messages);
    setHasOlderMessages(merged.hasMore);
  }

  async function refreshNewMessages(contactId = selectedId) {
    if (!contactId) return;
    const current = messagesRef.current;
    if (current.length === 0) {
      await loadLatestMessages(contactId);
      return;
    }
    const newest = current.at(-1);
    const material = secureMaterialRef.current;
    const plain = await api.messages(contactId, { after: newest.createdAt, limit: messagePageSize });
    let encryptedMessages = [];
    if (shouldLoadEncryptedMessages(material)) {
      const encrypted = await api.encryptedMessages(contactId, { after: newest.createdAt, limit: messagePageSize });
      encryptedMessages = await decryptEncryptedMessages(encrypted.messages);
    }
    if (plain.messages.length > 0 || encryptedMessages.length > 0) {
      setMessages((items) => mergeMessages(items, [...plain.messages, ...encryptedMessages]));
      return;
    }

    if (!isSecureLive(material?.conversation?.status)) {
      const latest = await api.messages(contactId, { limit: Math.min(Math.max(current.length, messagePageSize), 100) });
      if (latest.messages.length > 0) {
        setMessages((items) => mergeMessages(items, latest.messages));
      }
    }
  }

  async function loadOlderMessages(contactId = selectedId) {
    if (!contactId || loadingOlderMessagesRef.current || !hasOlderMessagesRef.current) return;
    const oldest = messagesRef.current[0];
    if (!oldest) return;
    loadingOlderMessagesRef.current = true;
    setLoadingOlderMessages(true);
    try {
      const merged = await fetchMergedMessages(contactId, { before: oldest.createdAt });
      setMessages((items) => mergeMessages(merged.messages, items));
      setHasOlderMessages(merged.hasMore);
    } finally {
      loadingOlderMessagesRef.current = false;
      setLoadingOlderMessages(false);
    }
  }

  async function refreshMessages(contactId = selectedId) {
    await loadLatestMessages(contactId);
  }

  function upsertMessages(incoming) {
    const items = Array.isArray(incoming) ? incoming : [incoming];
    setMessages((current) => mergeMessages(current, items));
  }

  function markMessagesReadLocally(contactId, readAt) {
    if (!readAt) return;
    setMessages((items) =>
      items.map((message) =>
        message.toId === user.id && !message.readAt
          ? { ...message, readAt }
          : message
      )
    );
  }

  function secureAad(conversationId, userId, keyVersion, wrapType) {
    return { conversationId, userId, keyVersion, wrapType, cryptoVersion: secureCryptoVersion };
  }

  function secureStateFromMaterial(material, contactId) {
    const status = material?.conversation?.status || 'off';
    const hasUserWrappedKey = Boolean(material?.userWrappedKey);
    const initiatorUserId = material?.conversation?.initiatorUserId || null;
    const isInitiator = Boolean(user && initiatorUserId === user.id);
    const peerAccepted = Boolean(material?.peerAccepted);
    const closeRequestedBy = material?.conversation?.closeRequestedBy || null;
    const conversationId = material?.conversation?.conversationId || (user && contactId ? makeConversationId(user.id, contactId) : '');
    const roots = getRootsByVersion(conversationId);
    const unlockedVersions = Object.keys(roots).map(Number);
    const historyUnlocked = unlockedVersions.length > 0;
    const lockedHistoryKeys = (material?.historicalUserWrappedKeys || []).filter(
      (item) => !roots[item.keyVersion]
    );
    return {
      status,
      enabled: Boolean(material?.conversation?.enabled),
      unlocked: Boolean(
        status === 'off'
          ? historyUnlocked
          : roots[material?.conversation?.currentKeyVersion]
      ),
      historyUnlocked,
      canUnlockHistory: lockedHistoryKeys.length > 0,
      conversationId,
      keyVersion: material?.conversation?.currentKeyVersion || 0,
      nextKeyVersion: material?.conversation?.nextKeyVersion || 1,
      initiatorUserId,
      isInitiator,
      peerAccepted,
      hasUserWrappedKey,
      hasHistoricalKeys: Boolean(material?.hasHistoricalKeys),
      closeRequestedBy,
      closeRequestedByMe: Boolean(user && closeRequestedBy === user.id),
      canAcceptInvite: status === 'waiting_peer' && !isInitiator && !hasUserWrappedKey,
      canCompleteInvite: status === 'waiting_peer' && isInitiator && peerAccepted && !hasUserWrappedKey
    };
  }

  async function loadSecureMaterial(contactId = selectedId) {
    if (!user || !contactId) return null;
    const conversationId = makeConversationId(user.id, contactId);
    try {
      const material = await api.secureKeyMaterial(conversationId);
      secureMaterialRef.current = material;
      setSecureChat(secureStateFromMaterial(material, contactId));
      return material;
    } catch {
      secureMaterialRef.current = null;
      setSecureChat({ status: 'off', unlocked: false, historyUnlocked: false, conversationId, hasHistoricalKeys: false });
      return null;
    }
  }

  async function unwrapWrappedRoot(wrapped, password, conversationId) {
    const keyVersion = Number(wrapped.keyVersion) || 1;
    const kek = await deriveLoginKek(password, user.id, wrapped.kdfSalt, wrapped.kdfParameters);
    return unwrapRootKey(
      wrapped,
      kek,
      secureAad(conversationId, user.id, keyVersion, 'user')
    );
  }

  async function unlockWrappedKeysWithPassword(password, wrappedKeys, conversationId, existingRoots = {}) {
    const rootsByVersion = { ...existingRoots };
    const failed = [];
    for (const wrapped of wrappedKeys || []) {
      if (rootsByVersion[wrapped.keyVersion]) continue;
      try {
        rootsByVersion[wrapped.keyVersion] = await unwrapWrappedRoot(wrapped, password, conversationId);
      } catch {
        failed.push(wrapped);
      }
    }
    return { rootsByVersion, failed };
  }

  async function decryptEncryptedMessages(encryptedMessages) {
    const rootsByVersion = getRootsByVersion();
    const decrypted = [];
    for (const message of encryptedMessages) {
      const rootKey = rootsByVersion[message.keyVersion];
      if (!rootKey) {
        decrypted.push({
          ...message,
          kind: 'text',
          text: '（加密消息，输入登录密码后可查看）',
          quote: null,
          sticker: null,
          decryptFailed: true,
          needsHistoryUnlock: true
        });
        continue;
      }
      try {
        const payload = await decryptMessage(rootKey, message);
        decrypted.push({
          ...message,
          kind: payload.kind || 'text',
          text: payload.text || '',
          quote: payload.quote || null,
          sticker: payload.sticker || null
        });
      } catch {
        decrypted.push({
          ...message,
          kind: 'text',
          text: '消息完整性校验失败，内容可能已损坏。',
          quote: null,
          sticker: null,
          decryptFailed: true
        });
      }
    }
    return decrypted;
  }

  function askSecureInput(config) {
    return new Promise((resolve) => {
      secureInputResolverRef.current = resolve;
      setSecureInputDialog(config);
    });
  }

  function finishSecureInput(values) {
    const resolve = secureInputResolverRef.current;
    secureInputResolverRef.current = null;
    setSecureInputDialog(null);
    resolve?.(values || null);
  }

  async function askLoginPassword(title, description, extraFields = []) {
    const values = await askSecureInput({
      title,
      description,
      fields: [
        { key: 'password', label: '登录密码', type: 'password', autoComplete: 'current-password' },
        ...extraFields
      ],
      confirmLabel: '确定'
    });
    if (!values?.password) return null;
    try {
      await api.verifyLoginPassword(values.password);
      return { password: values.password, values };
    } catch {
      if (values.allowOldPassword) {
        return { password: values.password, values, unverified: true };
      }
      alert('登录密码不正确');
      return null;
    }
  }

  async function askCurrentLoginPassword(title, description, extraFields = []) {
    const result = await askLoginPassword(title, description, extraFields);
    if (!result || result.unverified) {
      if (result?.unverified) alert('请输入现在使用的登录密码');
      return null;
    }
    return result.password;
  }

  async function buildUserWrappedRoot(rootKey, password, conversationId, keyVersion = 1) {
    const version = Number(keyVersion) || 1;
    const salt = randomSalt();
    const kek = await deriveLoginKek(password, user.id, salt, defaultKdfParameters);
    const userWrapped = await wrapRootKey(rootKey, kek, secureAad(conversationId, user.id, version, 'user'));
    return {
      ...userWrapped,
      kdfAlgorithm: 'Argon2id',
      kdfSalt: base64(salt),
      kdfParameters: defaultKdfParameters,
      keyVersion: version
    };
  }

  async function buildRewrapsWithPasswords(fromPassword, toPassword) {
    const wraps = await api.mySecureKeyWraps();
    const total = (wraps.userWrappedKeys || []).length + (wraps.handshakeKeys || []).length;
    if (total > 0) assertSecureChatSupported();
    const userWrappedKeys = [];
    let skippedUserKeys = 0;
    for (const wrapped of wraps.userWrappedKeys || []) {
      try {
        const rootKey = await unwrapWrappedRoot(wrapped, fromPassword, wrapped.conversationId);
        const next = await buildUserWrappedRoot(
          rootKey,
          toPassword,
          wrapped.conversationId,
          wrapped.keyVersion
        );
        userWrappedKeys.push({ conversationId: wrapped.conversationId, ...next });
      } catch {
        skippedUserKeys += 1;
      }
    }
    const handshakeKeys = [];
    let skippedHandshakeKeys = 0;
    for (const item of wraps.handshakeKeys || []) {
      try {
        const keyVersion = Number(item.currentKeyVersion || item.wrappedPrivateKey?.keyVersion || 1) || 1;
        const kek = await deriveLoginKek(
          fromPassword,
          user.id,
          item.wrappedPrivateKey.kdfSalt,
          item.wrappedPrivateKey.kdfParameters
        );
        const privateKey = await unwrapBytes(
          item.wrappedPrivateKey,
          kek,
          secureAad(item.conversationId, user.id, keyVersion, 'handshake')
        );
        const salt = randomSalt();
        const nextKek = await deriveLoginKek(toPassword, user.id, salt, defaultKdfParameters);
        const wrappedPrivate = await wrapBytes(
          privateKey,
          nextKek,
          secureAad(item.conversationId, user.id, keyVersion, 'handshake')
        );
        handshakeKeys.push({
          conversationId: item.conversationId,
          wrappedPrivateKey: {
            ...wrappedPrivate,
            kdfAlgorithm: 'Argon2id',
            kdfSalt: base64(salt),
            kdfParameters: defaultKdfParameters,
            keyVersion
          }
        });
      } catch {
        skippedHandshakeKeys += 1;
      }
    }
    return {
      total,
      userWrappedKeys,
      handshakeKeys,
      skipped: skippedUserKeys + skippedHandshakeKeys
    };
  }

  async function migrateSecureKeysFromPassword(fromPassword, toPassword, { silent = true } = {}) {
    const currentPassword = toPassword;
    if (!currentPassword) return null;
    if (fromPassword === currentPassword) return { rewrappedUserKeys: 0, rewrappedHandshakeKeys: 0, skipped: 0 };
    const built = await buildRewrapsWithPasswords(fromPassword, currentPassword);
    if (!built.userWrappedKeys.length && !built.handshakeKeys.length) {
      if (!silent) alert('没有能用这个旧密码打开的安全聊天。');
      return null;
    }
    const result = await api.rewrapSecureKeys(built.userWrappedKeys, built.handshakeKeys);
    if (selectedId) await loadSecureMaterial(selectedId);
    if (!silent) {
      alert(
        built.skipped > 0
          ? `已用新密码更新部分安全聊天；另有 ${built.skipped} 处仍需对应的旧密码才能打开。`
          : '已用新密码更新相关安全聊天，之后用新密码即可继续。'
      );
    }
    return { ...result, skipped: built.skipped };
  }

  async function unlockSecureChatWithPassword(password, material = secureMaterialRef.current) {
    if (!user || !material) throw new Error('请先和对方开启安全聊天');
    assertSecureChatSupported();
    const conversationId = material.conversation.conversationId;
    const currentWrapped = material.userWrappedKey;
    if (!currentWrapped) throw new Error('请先和对方完成安全聊天开启');
    const rootKey = await unwrapWrappedRoot(currentWrapped, password, conversationId);
    const rootsByVersion = {
      ...getRootsByVersion(conversationId),
      [currentWrapped.keyVersion]: rootKey
    };
    // Same login password may also open older wraps; try quietly, never prompt here.
    for (const wrapped of material.historicalUserWrappedKeys || []) {
      if (rootsByVersion[wrapped.keyVersion]) continue;
      try {
        rootsByVersion[wrapped.keyVersion] = await unwrapWrappedRoot(wrapped, password, conversationId);
      } catch {
        // Leave locked until user explicitly unlocks history.
      }
    }
    setSecureRoots(conversationId, rootsByVersion);
    setSecureChat(secureStateFromMaterial(material, selectedId));
    return { rootsByVersion };
  }

  async function promptUnlockSecureChat() {
    const material = secureMaterialRef.current || await loadSecureMaterial();
    if (!material?.userWrappedKey) {
      alert('请先和对方完成安全聊天开启。');
      return null;
    }
    assertSecureChatSupported();
    const values = await askSecureInput({
      title: '继续安全聊天',
      description: '输入开启时的登录密码，即可继续查看和发送加密聊天。\n若已改过密码：先填开启时的旧密码，再填现在的登录密码（相同可留空）。',
      fields: [
        { key: 'password', label: '开启时的登录密码', type: 'password', autoComplete: 'current-password' },
        { key: 'currentPassword', label: '现在的登录密码（与上面相同可留空）', type: 'password', autoComplete: 'current-password', required: false }
      ],
      confirmLabel: '继续'
    });
    if (!values?.password) return null;
    const wrapPassword = values.password;
    const currentPassword = String(values.currentPassword || '').trim() || wrapPassword;
    try {
      await api.verifyLoginPassword(currentPassword);
    } catch {
      alert('现在的登录密码不正确');
      return null;
    }
    try {
      const result = await unlockSecureChatWithPassword(wrapPassword, material);
      await loadLatestMessages(selectedId);
      if (wrapPassword !== currentPassword) {
        try {
          await migrateSecureKeysFromPassword(wrapPassword, currentPassword, { silent: true });
        } catch (error) {
          alert(error.message || '已解锁，但未能自动改用新密码，以后仍可用旧密码打开。');
        }
      }
      return result.rootsByVersion;
    } catch (err) {
      alert(err?.message?.includes('HTTPS') ? err.message : '无法继续，请确认开启时的登录密码是否正确。');
      return null;
    }
  }

  async function promptUnlockSecureHistory(failedWrapped = null, material = secureMaterialRef.current) {
    const source = material || secureMaterialRef.current || await loadSecureMaterial();
    const conversationId = source?.conversation?.conversationId || activeSecureConversationId();
    const pending = failedWrapped || (source?.historicalUserWrappedKeys || []).filter(
      (item) => !getRootsByVersion(conversationId)[item.keyVersion]
    );
    if (!pending.length) {
      if (source) {
        setSecureChat(secureStateFromMaterial(source, selectedId));
        await loadLatestMessages(selectedId);
      } else {
        alert('没有可查看的旧加密聊天。');
      }
      return getRootsByVersion(conversationId);
    }
    assertSecureChatSupported();
    const values = await askSecureInput({
      title: '查看以前的加密聊天',
      description: '输入当时开启时的登录密码，即可再次查看。\n若已改过密码：先填当时的旧密码，再填现在的登录密码（相同可留空）。',
      fields: [
        { key: 'password', label: '当时的登录密码', type: 'password', autoComplete: 'current-password' },
        { key: 'currentPassword', label: '现在的登录密码（与上面相同可留空）', type: 'password', autoComplete: 'current-password', required: false }
      ],
      confirmLabel: '查看'
    });
    if (!values?.password) return null;
    const wrapPassword = values.password;
    const currentPassword = String(values.currentPassword || '').trim() || wrapPassword;
    try {
      await api.verifyLoginPassword(currentPassword);
    } catch {
      alert('现在的登录密码不正确');
      return null;
    }
    try {
      const { rootsByVersion, failed } = await unlockWrappedKeysWithPassword(
        wrapPassword,
        pending,
        conversationId,
        getRootsByVersion(conversationId)
      );
      if (failed.length === pending.length) {
        alert('无法打开这些旧消息，请确认当时的登录密码是否正确。');
        return null;
      }
      setSecureRoots(source.conversation.conversationId, rootsByVersion);
      setSecureChat(secureStateFromMaterial(source, selectedId));
      if (failed.length) {
        alert(`已打开一部分旧消息，还有 ${failed.length} 段需要别的旧密码。`);
      }
      await loadLatestMessages(selectedId);
      if (pending.length - failed.length > 0 && wrapPassword !== currentPassword) {
        try {
          await migrateSecureKeysFromPassword(wrapPassword, currentPassword, { silent: true });
        } catch (error) {
          alert(error.message || '已可查看，但未能自动改用新密码，以后仍可用旧密码打开。');
        }
      }
      return rootsByVersion;
    } catch (err) {
      alert(err?.message?.includes('HTTPS') ? err.message : '无法查看这些旧消息。');
      return null;
    }
  }

  function lockSecureChat() {
    const conversationId = activeSecureConversationId();
    clearSecureRoots(conversationId || null);
    setMessages([]);
    setSecureChat((current) => ({ ...current, unlocked: false, historyUnlocked: false }));
    loadLatestMessages(selectedId).catch(console.error);
  }

  async function enableSecureChat() {
    if (!user || !selected) return;
    assertSecureChatSupported();
    const material = secureMaterialRef.current || await loadSecureMaterial(selected.id);
    const keyVersion = material?.conversation?.nextKeyVersion || 1;
    const password = await askCurrentLoginPassword(
      '邀请对方开启安全聊天',
      '开启后，聊天文字将加密存储。需要双方同意才能开启。\n请输入登录密码，向对方发出邀请。'
    );
    if (!password) return;
    const conversationId = makeConversationId(user.id, selected.id);
    const { publicKey, privateKey } = await generateEcdhKeyPair();
    const salt = randomSalt();
    const kek = await deriveLoginKek(password, user.id, salt, defaultKdfParameters);
    const wrappedPrivate = await wrapBytes(
      privateKey,
      kek,
      secureAad(conversationId, user.id, keyVersion, 'handshake')
    );
    await api.inviteSecureConversation({
      contactId: selected.id,
      publicKey: base64(publicKey),
      wrappedPrivateKey: {
        ...wrappedPrivate,
        kdfAlgorithm: 'Argon2id',
        kdfSalt: base64(salt),
        kdfParameters: defaultKdfParameters,
        keyVersion
      }
    });
    await loadSecureMaterial(selected.id);
    alert('邀请已发出。需要对方同意后才能开启。');
  }

  async function acceptSecureInvite() {
    if (!user || !selected) return;
    assertSecureChatSupported();
    const material = secureMaterialRef.current || await loadSecureMaterial(selected.id);
    const peerPublicB64 = material?.peerHandshake?.publicKey;
    if (!peerPublicB64) {
      alert('邀请已失效，请让对方重新发起。');
      return;
    }
    const password = await askCurrentLoginPassword(
      '同意开启安全聊天',
      '开启后，聊天文字将加密存储。需要双方同意才能开启。\n请输入登录密码以同意。'
    );
    if (!password) return;
    const conversationId = material.conversation.conversationId;
    const keyVersion = material.conversation.currentKeyVersion || 1;
    const { publicKey, privateKey } = await generateEcdhKeyPair();
    const rootKey = await deriveSharedRootKey(privateKey, fromBase64(peerPublicB64));
    const userWrappedKey = await buildUserWrappedRoot(rootKey, password, conversationId, keyVersion);
    await api.acceptSecureConversation({
      conversationId,
      publicKey: base64(publicKey),
      userWrappedKey
    });
    setSecureRoots(conversationId, { ...getRootsByVersion(conversationId), [keyVersion]: rootKey });
    await loadSecureMaterial(selected.id);
    await loadLatestMessages(selected.id);
    alert('你已同意，等待对方完成开启。');
  }

  async function completeSecureInvite() {
    if (!user || !selected) return;
    assertSecureChatSupported();
    const material = secureMaterialRef.current || await loadSecureMaterial(selected.id);
    if (!material?.peerAccepted || !material?.peerHandshake?.publicKey || !material?.handshake?.wrappedPrivateKey) {
      alert('对方还没有同意，或邀请已失效。请稍后再试，或重新邀请。');
      return;
    }
    const password = await askCurrentLoginPassword(
      '完成开启',
      '对方已同意。再输入一次登录密码，即可开始加密聊天。'
    );
    if (!password) return;
    const conversationId = material.conversation.conversationId;
    const keyVersion = material.conversation.currentKeyVersion || 1;
    const wrapped = material.handshake.wrappedPrivateKey;
    const kek = await deriveLoginKek(password, user.id, wrapped.kdfSalt, wrapped.kdfParameters);
    const privateKey = await unwrapBytes(wrapped, kek, secureAad(conversationId, user.id, keyVersion, 'handshake'));
    const rootKey = await deriveSharedRootKey(privateKey, fromBase64(material.peerHandshake.publicKey));
    const userWrappedKey = await buildUserWrappedRoot(rootKey, password, conversationId, keyVersion);
    await api.completeSecureConversation({ conversationId, userWrappedKey });
    setSecureRoots(conversationId, { ...getRootsByVersion(conversationId), [keyVersion]: rootKey });
    await loadSecureMaterial(selected.id);
    await loadLatestMessages(selected.id);
    alert('已开启。聊天文字将加密存储。');
  }

  async function requestCloseSecureChat() {
    if (!secureChat?.conversationId) return;
    const result = await askSecureInput({
      title: '申请关闭安全聊天',
      description: '关闭也需要双方同意。关闭后回到普通聊天；已加密保存的旧消息仍可用开启时的登录密码查看。',
      fields: [
        { key: 'ack', type: 'checkbox', label: '我明白：以后查看旧消息，需要记得开启时的登录密码' }
      ],
      confirmLabel: '申请关闭'
    });
    if (!result?.ack) return;
    await api.requestCloseSecureConversation(secureChat.conversationId);
    await loadSecureMaterial(selectedId);
    alert('已申请关闭，等待对方同意。');
  }

  async function confirmCloseSecureChat() {
    if (!secureChat?.conversationId) return;
    const result = await askSecureInput({
      title: '同意关闭安全聊天',
      description: '关闭也需要双方同意。关闭后回到普通聊天；已加密保存的旧消息仍可用开启时的登录密码查看。',
      fields: [
        { key: 'ack', type: 'checkbox', label: '我明白：以后查看旧消息，需要记得开启时的登录密码' }
      ],
      confirmLabel: '同意关闭'
    });
    if (!result?.ack) return;
    await api.confirmCloseSecureConversation(secureChat.conversationId);
    // Keep unlocked roots so history remains readable after close if already unlocked.
    await loadSecureMaterial(selectedId);
    await loadLatestMessages(selectedId);
    await refreshContacts();
    alert('安全聊天已关闭。');
  }

  async function cancelCloseSecureChat() {
    if (!secureChat?.conversationId) return;
    await api.cancelCloseSecureConversation(secureChat.conversationId);
    await loadSecureMaterial(selectedId);
  }

  async function cancelSecureInvite() {
    if (!secureChat?.conversationId) return;
    const ok = window.confirm('确定取消这次邀请吗？取消后需要重新邀请对方。');
    if (!ok) return;
    await api.disableSecureConversation(secureChat.conversationId);
    await loadSecureMaterial(selectedId);
    await loadLatestMessages(selectedId);
  }

  function selectContact(contact) {
    secureMaterialRef.current = null;
    setSecureChat({ status: 'off', unlocked: false, historyUnlocked: false });
    setMessages([]);
    setHasOlderMessages(false);
    setLoadingOlderMessages(false);
    messagesRef.current = [];
    setSelected(contact);
  }

  async function markSelectedRead(contactId = selectedId) {
    if (!contactId) return;
    const data = await api.markRead(contactId);
    markMessagesReadLocally(contactId, data.readAt);
    await refreshContacts();
  }

  async function refreshStickers() {
    const data = await api.stickers();
    setStickers(data.stickers);
  }

  useEffect(() => {
    const token = localStorage.getItem('doolulu.token');
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((data) => {
        hydrateSecureRoots(data.user.id);
        setUser(data.user);
      })
      .catch(() => localStorage.removeItem('doolulu.token'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    originalTitleRef.current = document.title;
    function updateVisibility() {
      const visible = !document.hidden;
      setPageVisible(visible);
      if (visible) {
        document.title = originalTitleRef.current;
      }
    }
    document.addEventListener('visibilitychange', updateVisibility);
    window.addEventListener('focus', updateVisibility);
    window.addEventListener('pageshow', updateVisibility);
    return () => {
      document.removeEventListener('visibilitychange', updateVisibility);
      window.removeEventListener('focus', updateVisibility);
      window.removeEventListener('pageshow', updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    refreshContacts().catch(console.error);
    refreshStickers().catch(console.error);
    const timer = setInterval(() => {
      refreshContacts().catch(console.error);
    }, 4000);
    return () => clearInterval(timer);
  }, [user, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setHasOlderMessages(false);
      return;
    }
    loadSecureMaterial(selectedId).catch(console.error);
    setMessages([]);
    setHasOlderMessages(false);
    loadLatestMessages(selectedId).catch(console.error);
    const timer = setInterval(() => {
      refreshNewMessages(selectedId).catch(console.error);
    }, 1500);
    const secureTimer = setInterval(() => {
      loadSecureMaterial(selectedId).catch(console.error);
    }, 3000);
    return () => {
      clearInterval(timer);
      clearInterval(secureTimer);
    };
  }, [selectedId, secureChat.status]);

  useEffect(() => {
    if (!user || !selectedId || !pageVisible) return;
    const hasUnreadIncoming = messages.some((message) => message.toId === user.id && !message.readAt);
    if (hasUnreadIncoming) {
      markSelectedRead(selectedId).catch(console.error);
    }
  }, [user, selectedId, pageVisible, messages]);

  useEffect(() => {
    if (!user) {
      document.title = originalTitleRef.current;
      return;
    }
    if (pageVisible) {
      document.title = originalTitleRef.current;
      return;
    }
    const unreadCount = contacts.reduce((total, contact) => total + (contact.unreadCount || 0), 0);
    document.title = unreadCount > 0 ? `(${unreadCount}) 新消息 - ${originalTitleRef.current}` : originalTitleRef.current;
  }, [contacts, pageVisible, user]);

  const sortedContacts = useMemo(() => contacts, [contacts]);

  if (loading) {
    return <div className="loading-screen">正在加载 doolulu...</div>;
  }

  if (!user) {
    return (
      <AuthPanel
        onLogin={(nextUser) => {
          hydrateSecureRoots(nextUser.id);
          setUser(nextUser);
        }}
      />
    );
  }

  if (user.isAdmin) {
    return <AdminPanel self={user} onLogout={clearSession} />;
  }

  const hideEmptyChatOnMobile = !selected && isMobileShell;

  return (
    <main className={`app-shell ${selected ? 'mobile-chat-selected' : 'mobile-contact-selected'} ${hideEmptyChatOnMobile ? 'mobile-empty-chat' : ''}`}>
      <ContactList
        contacts={sortedContacts}
        selectedId={selectedId}
        onSelect={selectContact}
        self={user}
        bubbleTheme={user.bubbleTheme || 'mint'}
        chatBgPreset={user.chatBgPreset || 'soft'}
        chatBgDataUrl={user.chatBgDataUrl || ''}
        onBubbleThemeChange={async (bubbleTheme) => {
          const previousUser = user;
          setUser((current) => (current ? { ...current, bubbleTheme } : current));
          try {
            const data = await api.updateBubbleTheme(bubbleTheme);
            setUser(data.user);
            await refreshContacts();
          } catch (err) {
            setUser(previousUser);
            throw err;
          }
        }}
        onChatBgPresetChange={async (chatBgPreset) => {
          const previousUser = user;
          setUser((current) => (current ? { ...current, chatBgPreset, chatBgDataUrl: '' } : current));
          try {
            const data = await api.updateChatBgPreset(chatBgPreset);
            setUser(data.user);
          } catch (err) {
            setUser(previousUser);
            throw err;
          }
        }}
        onChatBgUpload={async (chatBgDataUrl) => {
          const previousUser = user;
          setUser((current) => (current ? { ...current, chatBgDataUrl } : current));
          try {
            const data = await api.updateChatBgImage(chatBgDataUrl);
            setUser(data.user);
          } catch (err) {
            setUser(previousUser);
            throw err;
          }
        }}
        onChatBgClear={async () => {
          const previousUser = user;
          setUser((current) => (current ? { ...current, chatBgDataUrl: '' } : current));
          try {
            const data = await api.updateChatBgImage('');
            setUser(data.user);
          } catch (err) {
            setUser(previousUser);
            throw err;
          }
        }}
        onLogout={clearSession}
        onUpdateProfile={async (displayName) => {
          const data = await api.updateProfile(displayName);
          setUser(data.user);
          await refreshContacts();
        }}
        onChangePassword={async () => {
          const values = await askSecureInput({
            title: '修改登录密码',
            description: '改密后，能打开的加密聊天会自动跟上新密码。若还有更早的聊天用旧密码保护，之后输入对应旧密码仍可查看。',
            fields: [
              { key: 'currentPassword', label: '当前密码', type: 'password', autoComplete: 'current-password' },
              { key: 'newPassword', label: '新密码', type: 'password', autoComplete: 'new-password', minLength: 6 },
              { key: 'newPasswordConfirm', label: '确认新密码', type: 'password', autoComplete: 'new-password' }
            ],
            confirmKey: 'newPassword',
            confirmLabel: '保存'
          });
          if (!values) return;
          try {
            await api.verifyLoginPassword(values.currentPassword);
            const built = await buildRewrapsWithPasswords(values.currentPassword, values.newPassword);
            await api.changeLoginPassword(values.currentPassword, values.newPassword, {
              userWrappedKeys: built.userWrappedKeys,
              handshakeKeys: built.handshakeKeys
            });
            alert('密码修改成功，请使用新密码重新登录');
            clearSession();
          } catch (error) {
            alert(error.message || '修改密码失败');
          }
        }}
        onUpdateBio={async (bio) => {
          const data = await api.updateBio(bio);
          setUser(data.user);
          await refreshContacts();
        }}
        onUpdateAvatar={async (avatarDataUrl) => {
          const data = await api.updateAvatar(avatarDataUrl);
          setUser(data.user);
          await refreshContacts();
        }}
        onDeleteAccount={async () => {
          await api.deleteAccount();
          clearSession();
        }}
        onAddContact={async (username) => {
          await api.addContact(username);
          await refreshContacts();
        }}
        onDeleteContact={async (contact) => {
          await api.deleteContact(contact.id);
          if (selectedId === contact.id) {
            setSelected(null);
            setMessages([]);
            setHasOlderMessages(false);
          }
          await refreshContacts();
        }}
      />
      {!hideEmptyChatOnMobile && (
        <ChatWindow
          contact={selected}
          messages={messages}
          self={user}
          stickers={stickers}
          chatBgPreset={user.chatBgPreset || 'soft'}
          chatBgDataUrl={user.chatBgDataUrl || ''}
          hasOlderMessages={hasOlderMessages}
          loadingOlderMessages={loadingOlderMessages}
          onLoadOlderMessages={() => loadOlderMessages(selected.id).catch(console.error)}
          onSend={async (text, quoteId) => {
            if (isSecureLive()) {
              if (secureChat.status === 'waiting_peer') {
                throw new Error('请先和对方完成安全聊天开启');
              }
              const material = secureMaterialRef.current;
              const keyVersion = material?.conversation?.currentKeyVersion;
              const rootKey = getRootsByVersion()[keyVersion];
              if (!material || !rootKey) {
                await promptUnlockSecureChat();
                throw new Error('请先输入密码，解锁后再发送');
              }
              const ownMessages = messagesRef.current.filter((message) => message.fromId === user.id && message.sequenceNumber);
              let nextSequence = Math.max(0, ...ownMessages.map((message) => Number(message.sequenceNumber) || 0)) + 1;
              try {
                const seq = await api.nextEncryptedSequence(selected.id, keyVersion);
                nextSequence = Math.max(nextSequence, Number(seq.nextSequence) || 1);
              } catch {
                // Fall back to local estimate if sequence endpoint fails.
              }
              const quote = quoteId ? messagesRef.current.find((message) => message.id === quoteId) : null;
              const encrypted = await encryptMessage(rootKey, material.conversation.conversationId, user.id, nextSequence, {
                kind: 'text',
                text,
                quote: quote ? {
                  id: quote.id,
                  fromId: quote.fromId,
                  authorName: quote.fromId === user.id ? user.displayName : selected.displayName,
                  text: quote.text,
                  kind: quote.kind || 'text',
                  recalledAt: quote.recalledAt || null
                } : null
              });
              let data;
              try {
                data = await api.sendEncryptedMessage({
                  toId: selected.id,
                  ...encrypted,
                  keyVersion
                });
              } catch (error) {
                if (!String(error.message || '').includes('冲突')) throw error;
                const seq = await api.nextEncryptedSequence(selected.id, keyVersion);
                const retryEncrypted = await encryptMessage(
                  rootKey,
                  material.conversation.conversationId,
                  user.id,
                  Number(seq.nextSequence) || nextSequence + 1,
                  {
                    kind: 'text',
                    text,
                    quote: quote ? {
                      id: quote.id,
                      fromId: quote.fromId,
                      authorName: quote.fromId === user.id ? user.displayName : selected.displayName,
                      text: quote.text,
                      kind: quote.kind || 'text',
                      recalledAt: quote.recalledAt || null
                    } : null
                  }
                );
                data = await api.sendEncryptedMessage({
                  toId: selected.id,
                  ...retryEncrypted,
                  keyVersion
                });
              }
              upsertMessages({
                ...data.message,
                kind: 'text',
                text,
                quote: quote || null,
                sticker: null
              });
              await refreshContacts();
              return;
            }
            const data = await api.sendQuotedMessage(selected.id, text, quoteId);
            upsertMessages(data.message);
            await refreshContacts();
          }}
          onSendSticker={async (stickerId, quoteId) => {
            const data = await api.sendSticker(selected.id, stickerId, quoteId);
            upsertMessages(data.message);
            await refreshContacts();
          }}
          onAddSticker={async (payload) => {
            await api.addSticker(payload);
            await refreshStickers();
          }}
          onDeleteStickers={async (stickerIds) => {
            await Promise.all(stickerIds.map((stickerId) => api.deleteSticker(stickerId)));
            await refreshStickers();
          }}
          onRecall={async (messageId) => {
            const target = messagesRef.current.find((message) => message.id === messageId);
            if (target?.ciphertext) {
              throw new Error('加密消息暂不支持撤回');
            }
            const data = await api.recallMessage(messageId);
            upsertMessages(data.message);
            await refreshContacts();
          }}
          secureChat={secureChat}
          secureChatSupported={secureChatSupported}
          onEnableSecureChat={enableSecureChat}
          onUnlockSecureChat={promptUnlockSecureChat}
          onLockSecureChat={lockSecureChat}
          onAcceptSecureInvite={acceptSecureInvite}
          onCompleteSecureInvite={completeSecureInvite}
          onRequestCloseSecureChat={requestCloseSecureChat}
          onConfirmCloseSecureChat={confirmCloseSecureChat}
          onCancelCloseSecureChat={cancelCloseSecureChat}
          onCancelSecureInvite={cancelSecureInvite}
          onUnlockSecureHistory={() => promptUnlockSecureHistory()}
          onBack={() => setSelected(null)}
        />
      )}
      <SecureInputDialog
        dialog={secureInputDialog}
        onSubmit={finishSecureInput}
        onCancel={() => finishSecureInput(null)}
      />
    </main>
  );
}
