<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { post, getCurrent } from '../api';
import { connectProgress } from '../ws';
const emit = defineEmits<{ logout: [] }>();
const url = ref(''); const info = ref<any>(null); const checking = ref(false);
const stage = ref(''); const percent = ref(0); const logs = ref<string[]>([]); const status = ref('');
const stages: Record<string, string> = { resolving: '解析', downloading: '下载转码', uploading: '上传网盘', cleaning: '清理', done: '完成', error: '出错' };

async function validate() {
  info.value = null; checking.value = true;
  const { data } = await post('/api/validate', { url: url.value });
  info.value = data; checking.value = false;
}
async function submit() {
  const { status: st } = await post('/api/tasks', { url: url.value });
  if (st === 409) { logs.value.unshift('已有任务在进行中'); return; }
  logs.value = []; status.value = 'running';
}
function apply(e: any) {
  stage.value = e.stage; percent.value = e.percent; status.value = e.status;
  logs.value.unshift(`[${stages[e.stage] ?? e.stage}] ${e.message}`);
}
async function logout() { await post('/api/logout'); emit('logout'); }
onMounted(async () => {
  connectProgress(apply);
  const cur = await getCurrent(); if (cur) apply({ ...cur, message: '恢复任务' });
});
</script>
<template>
  <div class="max-w-2xl mx-auto p-6 space-y-5">
    <div class="flex justify-between items-center">
      <h1 class="text-2xl font-semibold">视频音频提取</h1>
      <button @click="logout" class="text-sm text-slate-500 hover:text-slate-800">退出</button>
    </div>
    <div class="bg-white rounded-2xl shadow p-5 space-y-3">
      <div class="flex gap-2">
        <input v-model="url" placeholder="粘贴视频链接 (Bilibili / YouTube ...)" class="flex-1 border rounded-lg px-3 py-2" />
        <button @click="validate" :disabled="checking" class="px-4 rounded-lg bg-slate-200 hover:bg-slate-300">校验</button>
      </div>
      <div v-if="info" class="text-sm">
        <p v-if="info.supported" class="text-green-600">✅ 支持:{{ info.title }} <span v-if="info.duration" class="text-slate-400">({{ Math.round(info.duration) }}s)</span></p>
        <p v-else class="text-red-500">❌ 不支持:{{ info.reason }}</p>
      </div>
      <button @click="submit" :disabled="!info?.supported || status === 'running'" class="w-full bg-slate-800 text-white rounded-lg py-2 disabled:opacity-40 hover:bg-slate-700">开始提取并上传</button>
    </div>
    <div v-if="stage" class="bg-white rounded-2xl shadow p-5 space-y-3">
      <div class="flex justify-between text-sm"><span>{{ stages[stage] ?? stage }}</span><span>{{ Math.round(percent) }}%</span></div>
      <div class="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div class="h-full bg-slate-800 transition-all" :style="{ width: percent + '%' }"></div>
      </div>
      <p v-if="status === 'failed'" class="text-red-500 text-sm">任务失败</p>
      <p v-if="status === 'success'" class="text-green-600 text-sm">全部完成 🎉</p>
      <div class="max-h-48 overflow-auto text-xs text-slate-500 font-mono space-y-0.5">
        <div v-for="(l, i) in logs" :key="i">{{ l }}</div>
      </div>
    </div>
  </div>
</template>
