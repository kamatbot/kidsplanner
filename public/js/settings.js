let settingsSection = 'family';

function showSettingsSection(section) {
  if (!['family', 'school', 'preferences', 'connections'].includes(section)) section = 'family';
  settingsSection = section;
  document.querySelectorAll('[data-settings-section]').forEach(el => { el.hidden = el.dataset.settingsSection !== section; });
  document.querySelectorAll('[data-settings-nav]').forEach(el => {
    if (el.dataset.settingsNav === section) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  const parent = document.getElementById('connections-parent-only');
  if (parent) parent.hidden = isKidSession();
  const notice = document.getElementById('kid-connections-notice');
  if (notice) notice.hidden = !isKidSession();
}

function kidAvatarMarkup(id) {
  const kid = ((currentFamily && currentFamily.kids) || []).find(k => k.id === id);
  if (!kid) return '';
  const photo = typeof kid.photo === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(kid.photo) && kid.photo.length <= 90000 ? kid.photo : '';
  return `<span class="kid-profile-avatar" style="--profile-color:${kidColorFor(id)}" aria-hidden="true">${photo ? `<img src="${photo}" alt="">` : esc((kid.name || '?')[0].toUpperCase())}</span>`;
}

function renderKidProfileEditor(kid) {
  return `<details class="kid-profile-editor" data-kid-editor="${esc(kid.id)}">
    <summary>${kidAvatarMarkup(kid.id)}<span class="kid-profile-name"><strong>${esc(kid.name)}</strong><span>${esc(kid.grade || 'Kid profile')}</span></span><span class="kid-profile-edit-label">Edit profile</span></summary>
    <form data-kid-id="${esc(kid.id)}" onsubmit="saveKidAppearance(event, this)">
      <p class="text-muted">This picture and color appear across your family’s calendars and chat.</p>
      <div class="kid-appearance-fields">
        <label>Profile color<input type="color" name="color" value="${/^#[0-9a-f]{6}$/i.test(kid.color) ? kid.color : '#6C63FF'}" oninput="previewKidColor(this)"></label>
        <label>Profile picture<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" onchange="prepareKidPhoto(this)"></label>
      </div>
      <div class="kid-appearance-preview">${kidAvatarMarkup(kid.id)}<span>Profile preview</span><button type="button" class="btn-secondary" onclick="clearKidPhoto(this.form)">Remove picture</button></div>
      <div class="kid-profile-actions"><button type="submit" class="btn-primary">Save profile</button><button type="button" class="btn-secondary" onclick="cancelKidAppearance(this.form)">Cancel</button><button type="button" class="kid-remove-button" onclick="handleRemoveKid('${esc(kid.id)}')">Remove child</button></div>
      <p class="kid-profile-status" role="status" aria-live="polite"></p>
    </form>
  </details>`;
}

function previewKidColor(input) {
  input.form.querySelector('.kid-appearance-preview .kid-profile-avatar').style.setProperty('--profile-color', input.value);
}

function cancelKidAppearance(form) {
  // Invalidates an in-flight image conversion before restoring the saved profile.
  form._photoVersion = (form._photoVersion || 0) + 1;
  renderManageFamily();
}

function clearKidPhoto(form) {
  form._photoVersion = (form._photoVersion || 0) + 1;
  form._kidPhoto = '';
  form._photoLoading = false;
  form.elements.photo.value = '';
  form.querySelector('[type=submit]').disabled = false;
  const kid = currentFamily.kids.find(k => k.id === form.dataset.kidId);
  form.querySelector('.kid-appearance-preview .kid-profile-avatar').textContent = (kid.name || '?')[0].toUpperCase();
  form.querySelector('.kid-profile-status').textContent = 'Picture removed from preview. Save profile to apply.';
}

async function prepareKidPhoto(input) {
  const file = input.files[0], form = input.form;
  if (!file) return;
  const status = form.querySelector('.kid-profile-status');
  const version = form._photoVersion = (form._photoVersion || 0) + 1;
  const saveButton = form.querySelector('[type=submit]');
  let url;
  try {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Choose a JPG, PNG, or WebP picture smaller than 10 MB.');
    form._photoLoading = true; saveButton.disabled = true;
    status.textContent = 'Preparing picture…';
    url = URL.createObjectURL(file);
    const img = new Image(); img.src = url; await img.decode();
    if (form._photoVersion !== version || !form.isConnected) return;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 160;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, 160, 160);
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    context.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 160, 160);
    form._kidPhoto = canvas.toDataURL('image/jpeg', 0.85);
    const preview = document.createElement('img'); preview.src = form._kidPhoto; preview.alt = '';
    form.querySelector('.kid-appearance-preview .kid-profile-avatar').replaceChildren(preview);
    status.textContent = 'Picture ready. Save profile to apply.';
  } catch (error) {
    if (form._photoVersion === version) { status.textContent = error.message || 'Could not read that picture. Try a different image.'; input.value = ''; }
  } finally {
    if (url) URL.revokeObjectURL(url);
    if (form._photoVersion === version) { form._photoLoading = false; saveButton.disabled = false; }
  }
}

async function saveKidAppearance(event, form) {
  event.preventDefault();
  if (isKidSession() || form._saving || form._photoLoading) return;
  const status = form.querySelector('.kid-profile-status');
  const patch = { color: form.elements.color.value };
  if (form._kidPhoto !== undefined) patch.photo = form._kidPhoto;
  form._saving = true;
  form.querySelectorAll('input, button').forEach(el => { el.disabled = true; });
  status.textContent = 'Saving profile…';
  try {
    const response = await window.auth.updateKid(form.dataset.kidId, patch);
    if (!response.family) throw new Error('Could not save your changes. Try again.');
    currentFamily = response.family; save('fam_family', currentFamily);
    renderManageFamily(); renderKidSwitcher(); renderCalendar(); renderTodayScreen();
    renderChatMessages(); renderChatDockAvatars(); renderHomeworkHub(); renderGoalsHub(); renderActivitiesHub();
    const editor = [...document.querySelectorAll('[data-kid-editor]')].find(el => el.dataset.kidEditor === form.dataset.kidId);
    if (editor) {
      editor.open = true;
      editor.querySelector('.kid-profile-status').textContent = 'Profile saved.';
      editor.querySelector('[type=submit]').focus({ preventScroll: true });
    }
  } catch (error) {
    status.textContent = error.message || 'Could not save your changes. Try again.';
  } finally {
    form._saving = false;
    form.querySelectorAll('input, button').forEach(el => { el.disabled = false; });
  }
}
