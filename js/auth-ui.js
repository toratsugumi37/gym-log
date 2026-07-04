// 로그인/회원가입 화면. 성공하면 onSuccess(user)를 부른다.

import { apiPost } from './api.js';

const $ = (sel) => document.querySelector(sel);

export function showAuthScreen() {
  $('#auth-screen').hidden = false;
  $('#app').hidden = true;
}

function optVal(sel) {
  const v = $(sel).value.trim();
  return v === '' ? null : v;
}

export function initAuth(onSuccess) {
  $('#show-join').onclick = () => {
    $('#login-form').hidden = true;
    $('#join-form').hidden = false;
  };
  $('#show-login').onclick = () => {
    $('#join-form').hidden = true;
    $('#login-form').hidden = false;
  };

  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    $('#login-error').textContent = '';
    try {
      const data = await apiPost('/api/auth?action=login', {
        username: $('#login-username').value.trim(),
        password: $('#login-password').value,
      });
      $('#login-password').value = '';
      onSuccess(data.user);
    } catch (err) {
      $('#login-error').textContent = err.message === 'unauthorized' ? '로그인이 필요해요' : err.message;
    }
  };

  $('#join-form').onsubmit = async (e) => {
    e.preventDefault();
    $('#join-error').textContent = '';
    try {
      const data = await apiPost('/api/auth?action=join', {
        username: $('#join-username').value.trim(),
        password: $('#join-password').value,
        nickname: $('#join-nickname').value.trim(),
        birthYear: optVal('#join-birth'),
        gender: optVal('#join-gender'),
        heightCm: optVal('#join-height'),
        goalWeight: optVal('#join-goal-weight'),
        goalText: optVal('#join-goal-text'),
      });
      $('#join-password').value = '';
      onSuccess(data.user);
    } catch (err) {
      $('#join-error').textContent = err.message;
    }
  };
}
