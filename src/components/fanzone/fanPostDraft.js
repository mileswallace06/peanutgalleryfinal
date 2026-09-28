export function hasFanPostDraft(draft) {
  return Boolean(draft.text.trim() || draft.event || draft.photo || draft.before || draft.after ||
    draft.fromSection.trim() || draft.fromRow.trim() || draft.toSection.trim() || draft.toRow.trim());
}

export function fanPostProblem(user, draft) {
  if (!user?.email?.trim()) return 'Sign in before sharing a post.';
  if (draft.type === 'seat_flex') {
    if (!draft.event?.id) return 'Choose the event for your Seat Flex.';
    if (!draft.before && !draft.after) return 'Add a before or after photo.';
  } else if (!draft.text.trim() && !draft.photo) {
    return 'Write something or add a photo.';
  }
  return null;
}

export function fanPostPayload(user, draft) {
  const problem = fanPostProblem(user, draft);
  if (problem) throw new Error(problem);
  const payload = {
    author_email: user.email.trim(),
    author_name: user.full_name?.trim() || user.email.trim(),
    text: draft.text.trim(),
    post_type: draft.type,
    event_id: draft.event?.id || null,
    event_title: draft.event?.title || null,
    event_city: draft.event?.city || null,
    reactions: { fire: [], eyes: [], peanut: [] },
  };
  if (draft.type === 'seat_flex') {
    payload.text ||= draft.fromSection.trim() && draft.toSection.trim()
      ? `Moved from Sec ${draft.fromSection.trim()}${draft.fromRow.trim() ? ` Row ${draft.fromRow.trim()}` : ''} → Sec ${draft.toSection.trim()}${draft.toRow.trim() ? ` Row ${draft.toRow.trim()}` : ''}`
      : 'A better view of the moment.';
    return { ...payload, before_photo_url: draft.before || null, after_photo_url: draft.after || null,
      from_section: draft.fromSection.trim() || null, from_row: draft.fromRow.trim() || null,
      to_section: draft.toSection.trim() || null, to_row: draft.toRow.trim() || null };
  }
  return { ...payload, text: payload.text || 'Photo from the moment.', photo_url: draft.photo || null };
}

// One task owner per composer. Synchronous locks also cover taps before React
// has rendered a disabled control. Failed requests release their locks.
export function createFanPostTasks({ upload, createPost }) {
  const uploads = new Set();
  let sharing = false;
  let posted = false;
  return {
    isSharing: () => sharing || posted,
    isUploading: slot => uploads.has(slot),
    async uploadPhoto(file, slot) {
      if (!file || uploads.has(slot) || sharing || posted) return null;
      if (!file.type?.startsWith('image/')) throw new Error('Choose an image file.');
      uploads.add(slot);
      try {
        const result = await upload({ file });
        if (!result?.file_url || typeof result.file_url !== 'string') throw new Error('Upload did not return a photo.');
        return result.file_url;
      } finally {
        uploads.delete(slot);
      }
    },
    async share(user, draft) {
      if (sharing || posted || uploads.size) return { status: 'busy' };
      const payload = fanPostPayload(user, draft);
      sharing = true;
      try {
        const post = await createPost(payload);
        posted = true;
        return { status: 'posted', post };
      } finally {
        sharing = false;
      }
    },
  };
}
