'use client';

import { useState } from 'react';
import { cls, ui } from '../lib/ui.jsx';

function CouplePlannerPanel({ tasks, selfLabel = '你', contactLabel = 'Ta', onAddTask, onUpdateTask, onDeleteTask, onClose }) {
  const [draft, setDraft] = useState({ time: '', place: '', plan: '' });
  const [formOpen, setFormOpen] = useState(false);
  const [filter, setFilter] = useState('active');
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const completedCount = tasks.filter((task) => task.done).length;
  const activeCount = tasks.length - completedCount;
  const pendingConfirmCount = tasks.filter((task) => !task.done && !(task.confirmedByA && task.confirmedByB)).length;

  async function submitTask(event) {
    event.preventDefault();
    const time = draft.time.trim();
    const place = draft.place.trim();
    const plan = draft.plan.trim();
    if (!time && !place && !plan) return;
    try {
      await onAddTask({ time, place, plan });
    } catch {
      return;
    }
    setDraft({ time: '', place: '', plan: '' });
    setFormOpen(false);
  }

  const visibleTasks = tasks.filter((task) => {
    if (filter === 'done') return task.done;
    if (filter === 'confirmed') return !task.done && task.confirmedByA && task.confirmedByB;
    if (filter === 'pending') return !task.done && !(task.confirmedByA && task.confirmedByB);
    return !task.done;
  });

  return (
    <aside className="planner-drawer" aria-label="两个人的待办">
      <div className="planner-drawer-header">
        <div className="planner-avatar-pair" aria-hidden="true">
          <span>{selfLabel}</span>
          <span>{contactLabel}</span>
        </div>
        <div className="planner-drawer-title">
          <h2>一起计划</h2>
          <p>
            共 {tasks.length} 个，已完成 {completedCount} 个，未完成 {activeCount} 个，其中 {pendingConfirmCount} 个待确认
          </p>
        </div>
        {onClose && (
          <button type="button" className="planner-close-button" onClick={onClose} aria-label="收回待办">
            收回
          </button>
        )}
      </div>

      <div className="planner-drawer-controls">
        <button type="button" className="planner-add-toggle" onClick={() => setFormOpen((open) => !open)}>
          {formOpen ? '收起添加' : '+ 添加计划'}
        </button>
        {formOpen && (
          <form className="planner-drawer-form" onSubmit={submitTask}>
            <input
              value={draft.time}
              onChange={(event) => setDraft({ ...draft, time: event.target.value })}
              placeholder="时间"
            />
            <input
              className={ui.input}
              value={draft.place}
              onChange={(event) => setDraft({ ...draft, place: event.target.value })}
              placeholder="地点"
            />
            <input
              className="planner-drawer-plan"
              value={draft.plan}
              onChange={(event) => setDraft({ ...draft, plan: event.target.value })}
              placeholder="写下要一起做的事"
            />
            <button type="submit">添加</button>
          </form>
        )}
      </div>

      <div className="planner-filter-tabs" aria-label="待办筛选">
        {[
          { value: 'active', label: '未完成' },
          { value: 'pending', label: '待确认' },
          { value: 'confirmed', label: '已确认' },
          { value: 'done', label: '已完成' }
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            className={filter === option.value ? 'active' : ''}
            onClick={() => setFilter(option.value)}
            aria-pressed={filter === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="planner-drawer-list">
        {visibleTasks.map((task) => {
          const confirmed = task.confirmedByA && task.confirmedByB;
          const expanded = expandedTaskId === task.id;
          return (
            <article className={cls('planner-mini-task', task.done && 'done')} key={task.id}>
              <div className="planner-mini-main">
                <input
                  type="checkbox"
                  checked={task.done}
                  onChange={(event) => onUpdateTask(task.id, { done: event.target.checked })}
                  aria-label={task.done ? '标记未完成' : '标记完成'}
                />
                <button type="button" onClick={() => setExpandedTaskId(expanded ? null : task.id)}>
                  <strong>{task.plan || '未填写计划'}</strong>
                  <em>
                    {task.time || '未填写时间'} · {task.place || '未填写地点'} · {confirmed ? '双方已确认' : '待确认'}
                  </em>
                </button>
              </div>

              {expanded && (
                <div className="planner-mini-actions" aria-label="双方确认">
                  <button
                    type="button"
                    className={task.confirmedByA ? 'active' : ''}
                    onClick={() => onUpdateTask(task.id, { confirmedByA: !task.confirmedByA })}
                  >
                    你确认
                  </button>
                  <button
                    type="button"
                    className={task.confirmedByB ? 'active' : ''}
                    disabled
                  >
                    Ta 确认
                  </button>
                  <button type="button" className="planner-delete-button" onClick={() => onDeleteTask(task.id)}>
                    删除
                  </button>
                </div>
              )}
            </article>
          );
        })}
        {visibleTasks.length === 0 && (
          <div className="planner-drawer-empty">
            {tasks.length === 0 ? '还没有计划。' : '当前筛选下没有计划。'}
          </div>
        )}
      </div>
    </aside>
  );
}

export { CouplePlannerPanel };
