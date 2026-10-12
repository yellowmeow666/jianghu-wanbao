Component({
  methods: {
    open() {
      const pages = getCurrentPages()
      const current = pages[pages.length - 1]
      // 已经在阅读须知页时不再叠一层，避免来回跳转
      if (current && current.route === 'pages/disclaimer/disclaimer') return
      wx.navigateTo({ url: '/pages/disclaimer/disclaimer' })
    },
  },
})
