<script setup lang="ts">
import { ref, onMounted } from 'vue';
import Login from './views/Login.vue';
import Home from './views/Home.vue';
const authed = ref(false);
async function check() { const res = await fetch('/api/tasks/current'); authed.value = res.status !== 401; }
onMounted(check);
</script>
<template>
  <div class="min-h-screen bg-slate-50 text-slate-800">
    <Login v-if="!authed" @ok="authed = true" />
    <Home v-else @logout="authed = false" />
  </div>
</template>
