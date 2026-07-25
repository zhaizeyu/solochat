'use client';

import { useEffect, useState } from 'react';
import { Button } from '../lib/ui.jsx';

function SecureInputDialog({ dialog, onSubmit, onCancel }) {
  const [values, setValues] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (!dialog) return;
    const initial = {};
    for (const field of dialog.fields || []) {
      initial[field.key] = field.type === 'checkbox' ? false : '';
    }
    setValues(initial);
    setError('');
  }, [dialog]);

  if (!dialog) return null;

  function updateField(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function submit(event) {
    event.preventDefault();
    for (const field of dialog.fields || []) {
      if (field.type === 'checkbox') {
        if (field.required !== false && !values[field.key]) {
          setError(`请勾选：${field.label}`);
          return;
        }
        continue;
      }
      const value = String(values[field.key] || '').trim();
      if (!value) {
        if (field.required === false) continue;
        setError(`请填写${field.label}`);
        return;
      }
      if (field.minLength && value.length < field.minLength) {
        setError(`${field.label}至少 ${field.minLength} 位`);
        return;
      }
    }
    if (dialog.confirmKey) {
      const primary = String(values[dialog.confirmKey] || '');
      const confirm = String(values[`${dialog.confirmKey}Confirm`] || '');
      if (primary !== confirm) {
        setError('两次输入不一致');
        return;
      }
    }
    onSubmit?.(values);
  }

  return (
    <div className="secure-secret-backdrop" role="presentation">
      <form className="secure-secret-dialog secure-input-dialog" role="dialog" aria-modal="true" aria-labelledby="secure-input-title" onSubmit={submit}>
        <div className="secure-secret-head">
          <div>
            <h2 id="secure-input-title">{dialog.title}</h2>
            {dialog.description && <p style={{ whiteSpace: 'pre-wrap' }}>{dialog.description}</p>}
          </div>
          <button type="button" onClick={onCancel} aria-label="取消">×</button>
        </div>
        <div className="secure-input-fields">
          {(dialog.fields || []).map((field) => (
            field.type === 'checkbox' ? (
              <label className="secure-input-field secure-input-checkbox" key={field.key}>
                <input
                  type="checkbox"
                  checked={Boolean(values[field.key])}
                  onChange={(event) => updateField(field.key, event.target.checked)}
                />
                <span>{field.label}</span>
              </label>
            ) : (
              <label className="secure-input-field" key={field.key}>
                <span>{field.label}</span>
                <input
                  type={field.type || 'text'}
                  value={values[field.key] || ''}
                  placeholder={field.placeholder || ''}
                  autoComplete={field.autoComplete || 'off'}
                  autoFocus={field === dialog.fields.find((item) => item.type !== 'checkbox')}
                  onChange={(event) => updateField(field.key, event.target.value)}
                />
              </label>
            )
          ))}
        </div>
        {error && <div className="inline-error">{error}</div>}
        <div className="secure-secret-actions">
          <Button type="button" onClick={onCancel}>取消</Button>
          <Button type="submit" variant="primary">{dialog.confirmLabel || '确定'}</Button>
        </div>
      </form>
    </div>
  );
}

export { SecureInputDialog };
