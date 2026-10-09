import { useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, X } from 'lucide-react';

export const FAN_SORT_OPTIONS = [
  { id: 'upcoming', label: 'Upcoming Soonest' },
  { id: 'newest_posted', label: 'Newest Posted' },
  { id: 'recent_activity', label: 'Most Recent Activity' },
  { id: 'most_liked', label: 'Most Liked' },
  { id: 'most_commented', label: 'Most Commented' },
  { id: 'closest', label: 'Closest Distance' },
  { id: 'oldest_event', label: 'Oldest' },
];

export default function FanSortSheet({ value, allowDistance, onChange, onClose, triggerRef }) {
  const closeButton = useRef(null);
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="pg-fan-sort-backdrop" />
      <Dialog.Content aria-modal="true" className="pg-ticket-app pg-fan-sort-dialog"
        onOpenAutoFocus={event => { event.preventDefault(); closeButton.current?.focus(); }}
        onCloseAutoFocus={event => { event.preventDefault(); if (triggerRef?.current?.isConnected) triggerRef.current.focus({ preventScroll: true }); }}>
        <header>
          <Dialog.Title>Sort posts</Dialog.Title>
          <Dialog.Close asChild><button ref={closeButton} type="button" aria-label="Close sort sheet"><X size={21} aria-hidden="true" /></button></Dialog.Close>
        </header>
        <Dialog.Description>Choose how to order the posts in this feed.</Dialog.Description>
        <div className="pg-fan-sort-options" role="group" aria-label="Post sort order">
          {FAN_SORT_OPTIONS.filter(option => option.id !== 'closest' || allowDistance).map(option => <button
            key={option.id} type="button" aria-pressed={value === option.id}
            onClick={() => { onChange(option.id); onClose(); }}>
            <span>{option.label}</span>{value === option.id && <Check size={17} aria-hidden="true" />}
          </button>)}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
