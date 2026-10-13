// The gateway supplies only the current forum username; edits stay in this game.
(function () {
  const input = document.getElementById('guest_nametext');
  input.value = '';
  input.maxLength = 120;
  let edited = false, selected = false;
  input.addEventListener('input', () => { edited = true; });
  document.getElementById('guestPlayButton').addEventListener('click', event => {
    if (!input.value.trim() || [...input.value].length > 60) {
      event.stopImmediatePropagation();
      window.alert('请输入 1 至 60 个字符的玩家昵称。');
      return;
    }
    selected = true;
  }, true);
  fetch('/_blackroom/me', { cache: 'no-store', signal: AbortSignal.timeout(4000) })
    .then(response => response.ok ? response.json() : null)
    .then(profile => {
      if (!edited && !selected && typeof profile?.username === 'string' && [...profile.username].length <= 60) {
        input.value = profile.username;
      }
    }).catch(() => {});
})();
