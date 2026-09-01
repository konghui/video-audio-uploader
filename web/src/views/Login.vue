<script setup lang="ts">
import { ref } from 'vue';
import { post } from '../api';
const emit = defineEmits<{ ok: [] }>();
const username = ref(''); const password = ref(''); const error = ref('');
async function submit() {
  const { status } = await post('/api/login', { username: username.value, password: password.value });
  if (status === 200) emit('ok'); else error.value = '用户名或密码错误';
}
</script>
<template>
  <div class="flex items-center justify-center min-h-screen">
    <div class="w-80 bg-white rounded-2xl shadow p-8 space-y-4">
      <h1 class="text-xl font-semibold text-center">登录</h1>
      <input v-model="username" placeholder="用户名" class="w-full border rounded-lg px-3 py-2" />
      <input v-model="password" type="password" placeholder="密码" class="w-full border rounded-lg px-3 py-2" @keyup.enter="submit" />
      <p v-if="error" class="text-red-500 text-sm">{{ error }}</p>
      <button @click="submit" class="w-full bg-slate-800 text-white rounded-lg py-2 hover:bg-slate-700">进入</button>
    </div>
  </div>
</template>
