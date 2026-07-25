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
import { bubblePresets, messagePageSize, useMobileShell } from './lib/ui.jsx';
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
  const secureRootRef = useRef(null);
  const secureMaterialRef = useRef(null);
  const loadingOlderMessagesRef = useRef(false);
  const hasOlderMessagesRef = useRef(false);
  const originalTitleRef = useRef('doolulu');
  const isMobileShell = useMobileShell();

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
    secureRootRef.current = null;
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

  function getRootsByVersion() {
    return secureRootRef.current?.rootsByVersion || {};
  }

  function setSecureRoots(conversationId, rootsByVersion) {
    secureRootRef.current = { conversationId, rootsByVersion: { ...rootsByVersion } };
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
    const roots = secureRootRef.current?.conversationId === conversationId ? getRootsByVersion() : {};
    const unlockedVersions = Object.keys(roots).map(Number);
    const historyUnlocked = unlockedVersions.length > 0;
    const lockedHistoryKeys = (material?.historicalUserWrappedKeys || []).filter(
      (item) => !roots[item.keyVersion]
    );
    return {
      status,
      enabled: Boolean(material?.conversation?.enabled),
      unlocked: Boolean(
        secureRootRef.current?.conversationId === conversationId
        && (status === 'off'
          ? historyUnlocked
          : roots[material?.conversation?.currentKeyVersion])
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
      secureRootRef.current = null;
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
          text: '历史加密消息（需对应登录密码解锁后查看）',
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
      alert('登录密码错误');
      return null;
    }
  }

  async function askCurrentLoginPassword(title, description, extraFields = []) {
    const result = await askLoginPassword(title, description, extraFields);
    if (!result || result.unverified) {
      if (result?.unverified) alert('请输入当前登录密码');
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
      if (!silent) alert('没有可用旧密码解开的密钥可迁移。');
      return null;
    }
    const result = await api.rewrapSecureKeys(built.userWrappedKeys, built.handshakeKeys);
    if (selectedId) await loadSecureMaterial(selectedId);
    if (!silent) {
      alert(
        built.skipped > 0
          ? `已将 ${result.rewrappedUserKeys} 个会话密钥和 ${result.rewrappedHandshakeKeys} 个握手密钥改用当前密码封装；另有 ${built.skipped} 个仍需其他旧密码。`
          : `已将 ${result.rewrappedUserKeys} 个会话密钥和 ${result.rewrappedHandshakeKeys} 个握手密钥改用当前密码封装。`
      );
    }
    return { ...result, skipped: built.skipped };
  }

  async function unlockSecureChatWithPassword(password, material = secureMaterialRef.current) {
    if (!user || !material) throw new Error('缺少安全聊天材料');
    assertSecureChatSupported();
    const conversationId = material.conversation.conversationId;
    const currentWrapped = material.userWrappedKey;
    if (!currentWrapped) throw new Error('当前账号还没有安全聊天密钥');
    const rootKey = await unwrapWrappedRoot(currentWrapped, password, conversationId);
    const rootsByVersion = {
      ...getRootsByVersion(),
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
      alert('请先完成安全聊天开启。');
      return null;
    }
    assertSecureChatSupported();
    const values = await askSecureInput({
      title: '解锁安全聊天',
      description: '若密钥仍是旧密码封装的，请同时填写当前登录密码；解锁成功后会自动改用当前密码封装。',
      fields: [
        { key: 'password', label: '封装密码', type: 'password', autoComplete: 'current-password' },
        { key: 'currentPassword', label: '当前登录密码（与上面相同时可留空）', type: 'password', autoComplete: 'current-password', required: false }
      ],
      confirmLabel: '确定'
    });
    if (!values?.password) return null;
    const wrapPassword = values.password;
    const currentPassword = String(values.currentPassword || '').trim() || wrapPassword;
    try {
      await api.verifyLoginPassword(currentPassword);
    } catch {
      alert('当前登录密码错误');
      return null;
    }
    try {
      const result = await unlockSecureChatWithPassword(wrapPassword, material);
      await loadLatestMessages(selectedId);
      if (wrapPassword !== currentPassword) {
        try {
          await migrateSecureKeysFromPassword(wrapPassword, currentPassword, { silent: true });
        } catch (error) {
          alert(error.message || '自动更新密钥封装失败');
        }
      }
      return result.rootsByVersion;
    } catch (err) {
      alert(err?.message?.includes('HTTPS') ? err.message : '无法解锁，请检查封装密码。');
      return null;
    }
  }

  async function promptUnlockSecureHistory(failedWrapped = null, material = secureMaterialRef.current) {
    const source = material || secureMaterialRef.current || await loadSecureMaterial();
    const pending = failedWrapped || (source?.historicalUserWrappedKeys || []).filter(
      (item) => !getRootsByVersion()[item.keyVersion]
    );
    if (!pending.length) {
      if (source) {
        setSecureChat(secureStateFromMaterial(source, selectedId));
        await loadLatestMessages(selectedId);
      } else {
        alert('没有可解锁的历史加密消息。');
      }
      return getRootsByVersion();
    }
    assertSecureChatSupported();
    const values = await askSecureInput({
      title: '解锁历史加密消息',
      description: '解密成功后会自动把这些历史密钥改用当前登录密码封装。',
      fields: [
        { key: 'password', label: '历史封装密码', type: 'password', autoComplete: 'current-password' },
        { key: 'currentPassword', label: '当前登录密码（与上面相同时可留空）', type: 'password', autoComplete: 'current-password', required: false }
      ],
      confirmLabel: '确定'
    });
    if (!values?.password) return null;
    const wrapPassword = values.password;
    const currentPassword = String(values.currentPassword || '').trim() || wrapPassword;
    try {
      await api.verifyLoginPassword(currentPassword);
    } catch {
      alert('当前登录密码错误');
      return null;
    }
    try {
      const { rootsByVersion, failed } = await unlockWrappedKeysWithPassword(
        wrapPassword,
        pending,
        source.conversation.conversationId,
        getRootsByVersion()
      );
      if (failed.length === pending.length) {
        alert('无法解锁历史消息，请确认历史封装密码是否正确。');
        return null;
      }
      setSecureRoots(source.conversation.conversationId, rootsByVersion);
      setSecureChat(secureStateFromMaterial(source, selectedId));
      if (failed.length) {
        alert(`已解锁部分历史版本，仍有 ${failed.length} 个版本未能解锁。`);
      }
      await loadLatestMessages(selectedId);
      if (pending.length - failed.length > 0 && wrapPassword !== currentPassword) {
        try {
          await migrateSecureKeysFromPassword(wrapPassword, currentPassword, { silent: true });
        } catch (error) {
          alert(error.message || '自动更新历史密钥封装失败');
        }
      }
      return rootsByVersion;
    } catch (err) {
      alert(err?.message?.includes('HTTPS') ? err.message : '无法解锁历史消息。');
      return null;
    }
  }

  function lockSecureChat() {
    secureRootRef.current = null;
    setMessages([]);
    setSecureChat((current) => ({ ...current, unlocked: false, historyUnlocked: false }));
    loadLatestMessages(selectedId).catch(console.error);
  }

  async function enableSecureChat() {
    if (!user || !selected) return;
    assertSecureChatSupported();
    const material = secureMaterialRef.current || await loadSecureMaterial(selected.id);
    const keyVersion = material?.conversation?.nextKeyVersion || 1;
    const password = await askCurrentLoginPassword('邀请开启安全聊天', '输入登录密码，向对方发送安全聊天邀请。');
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
    alert('已发送邀请，等待对方同意。');
  }

  async function acceptSecureInvite() {
    if (!user || !selected) return;
    assertSecureChatSupported();
    const material = secureMaterialRef.current || await loadSecureMaterial(selected.id);
    const peerPublicB64 = material?.peerHandshake?.publicKey;
    if (!peerPublicB64) {
      alert('邀请信息无效或已过期。');
      return;
    }
    const password = await askCurrentLoginPassword('同意安全聊天', '输入登录密码以同意并完成本地密钥设置。');
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
    setSecureRoots(conversationId, { ...getRootsByVersion(), [keyVersion]: rootKey });
    await loadSecureMaterial(selected.id);
    await loadLatestMessages(selected.id);
    alert('已同意。等待对方确认后即可双方收发加密消息。');
  }

  async function completeSecureInvite() {
    if (!user || !selected) return;
    assertSecureChatSupported();
    const material = secureMaterialRef.current || await loadSecureMaterial(selected.id);
    if (!material?.peerAccepted || !material?.peerHandshake?.publicKey || !material?.handshake?.wrappedPrivateKey) {
      alert('对方尚未同意，或握手信息不完整。');
      return;
    }
    const password = await askCurrentLoginPassword('确认开启', '输入登录密码，完成安全聊天开启。');
    if (!password) return;
    const conversationId = material.conversation.conversationId;
    const keyVersion = material.conversation.currentKeyVersion || 1;
    const wrapped = material.handshake.wrappedPrivateKey;
    const kek = await deriveLoginKek(password, user.id, wrapped.kdfSalt, wrapped.kdfParameters);
    const privateKey = await unwrapBytes(wrapped, kek, secureAad(conversationId, user.id, keyVersion, 'handshake'));
    const rootKey = await deriveSharedRootKey(privateKey, fromBase64(material.peerHandshake.publicKey));
    const userWrappedKey = await buildUserWrappedRoot(rootKey, password, conversationId, keyVersion);
    await api.completeSecureConversation({ conversationId, userWrappedKey });
    setSecureRoots(conversationId, { ...getRootsByVersion(), [keyVersion]: rootKey });
    await loadSecureMaterial(selected.id);
    await loadLatestMessages(selected.id);
    alert('安全聊天已开启。');
  }

  async function requestCloseSecureChat() {
    if (!secureChat?.conversationId) return;
    const result = await askSecureInput({
      title: '申请关闭安全聊天',
      description: '关闭后将回到明文聊天。历史加密消息仍会保留，但需要你记得开启时所用的登录密码才能解密查看。若之后修改登录密码且未用旧密码解锁，旧消息可能无法解密。需要双方都确认后才会关闭。',
      fields: [
        { key: 'ack', type: 'checkbox', label: '我知道需要保留当时的登录密码才能查看历史加密消息' }
      ],
      confirmLabel: '申请关闭'
    });
    if (!result?.ack) return;
    await api.requestCloseSecureConversation(secureChat.conversationId);
    await loadSecureMaterial(selectedId);
    alert('已申请关闭，等待对方确认。');
  }

  async function confirmCloseSecureChat() {
    if (!secureChat?.conversationId) return;
    const result = await askSecureInput({
      title: '确认关闭安全聊天',
      description: '对方申请关闭安全聊天。关闭后回到明文聊天；历史密文会保留，需用当时的登录密码才能查看。',
      fields: [
        { key: 'ack', type: 'checkbox', label: '我知道需要保留当时的登录密码才能查看历史加密消息' }
      ],
      confirmLabel: '确认关闭'
    });
    if (!result?.ack) return;
    await api.confirmCloseSecureConversation(secureChat.conversationId);
    // Keep unlocked roots so history remains readable after close if already unlocked.
    await loadSecureMaterial(selectedId);
    await loadLatestMessages(selectedId);
    await refreshContacts();
    alert('安全聊天已关闭。可用「解锁历史消息」查看旧密文。');
  }

  async function cancelCloseSecureChat() {
    if (!secureChat?.conversationId) return;
    await api.cancelCloseSecureConversation(secureChat.conversationId);
    await loadSecureMaterial(selectedId);
  }

  async function cancelSecureInvite() {
    if (!secureChat?.conversationId) return;
    const ok = window.confirm('取消当前邀请？未完成的本次密钥不会保留。');
    if (!ok) return;
    await api.disableSecureConversation(secureChat.conversationId);
    await loadSecureMaterial(selectedId);
    await loadLatestMessages(selectedId);
  }

  function selectContact(contact) {
    secureRootRef.current = null;
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
      .then((data) => setUser(data.user))
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
    return <AuthPanel onLogin={setUser} />;
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
        bubblePresets={bubblePresets}
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
        onLogout={clearSession}
        onUpdateProfile={async (displayName) => {
          const data = await api.updateProfile(displayName);
          setUser(data.user);
          await refreshContacts();
        }}
        onChangePassword={async () => {
          const values = await askSecureInput({
            title: '修改登录密码',
            description: '能用当前密码解开的安全聊天密钥会自动改用新密码封装；解不开的旧密钥会保留，之后仍可用对应旧密码查看。',
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
          bubblePresets={bubblePresets}
          hasOlderMessages={hasOlderMessages}
          loadingOlderMessages={loadingOlderMessages}
          onLoadOlderMessages={() => loadOlderMessages(selected.id).catch(console.error)}
          onSend={async (text, quoteId) => {
            if (isSecureLive()) {
              if (secureChat.status === 'waiting_peer') {
                throw new Error('请先完成安全聊天开启');
              }
              const material = secureMaterialRef.current;
              const keyVersion = material?.conversation?.currentKeyVersion;
              const rootKey = getRootsByVersion()[keyVersion];
              if (!material || !rootKey) {
                await promptUnlockSecureChat();
                throw new Error('请先解锁安全聊天');
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
              throw new Error('加密消息暂不支持撤回。');
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
