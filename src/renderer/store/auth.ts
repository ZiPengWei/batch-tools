import { defineStore } from 'pinia'
import { setAuth } from '../ipc/bridge'
import { useProjectsStore } from './projects'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    baseUrl: 'http://172.16.43.4:30085',
    token: '',
    rememberToken: false,
    connected: false,
    userName: '',
    username: '',
    error: '',
    busy: false,
  }),
  actions: {
    loadLocal() {
      try {
        const raw = localStorage.getItem('gitlab-auth')
        if (!raw) return
        const data = JSON.parse(raw) as any
        if (typeof data.baseUrl === 'string') this.baseUrl = data.baseUrl
        if (typeof data.token === 'string') this.token = data.token
        if (typeof data.rememberToken === 'boolean') this.rememberToken = data.rememberToken
      } catch {}
    },
    saveLocal() {
      if (!this.rememberToken) {
        localStorage.removeItem('gitlab-auth')
        return
      }
      localStorage.setItem(
        'gitlab-auth',
        JSON.stringify({
          baseUrl: this.baseUrl,
          token: this.token,
          rememberToken: this.rememberToken,
        }),
      )
    },
    async connect() {
      this.error = ''
      if (!this.baseUrl.trim() || !this.token.trim()) {
        this.error = '请输入 URL 和 Token'
        return
      }
      this.busy = true
      try {
        const res = await setAuth({ baseUrl: this.baseUrl.trim(), token: this.token.trim() })
        if (res?.ok) {
          this.connected = true
          this.userName = res.user?.name || ''
          this.username = res.user?.username || ''
          this.saveLocal()
          const projects = useProjectsStore()
          projects.loadProjects()
        } else {
          this.connected = false
          this.error = res?.error?.message || '认证失败'
        }
      } catch (e) {
        this.connected = false
        this.error = String(e)
      } finally {
        this.busy = false
      }
    },
  },
})
