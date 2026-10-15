# 天才交易员

自选股票 / 基金盯盘 Chrome 扩展（A股 · 港股 · 美股 · 日韩指数 · 场外基金）。

在线体验：[GitHub Pages](https://z1994838315g.github.io/genius-trader/)

> 说明：本机对 `guozhong123/genius-trader` 无写权限，代码与 Pages 发布在可写账号 [z1994838315g/genius-trader](https://github.com/z1994838315g/genius-trader)。若需同步到原仓库，请用 `guozhong123` 账号授权后 push。

## 本地安装（扩展）

```bash
npm install
npm run build
```

1. 打开 Chrome `chrome://extensions`
2. 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择本项目的 `dist` 目录
4. 点击扩展图标，进入全屏盯盘页

## 发布 Pages

```bash
npm install
# Windows PowerShell
$env:VITE_BASE="/genius-trader/"; npm run build:web
npm run deploy:pages
```

## 功能

- 自选股票 / 基金：分组（增删改、拖拽）、涨跌循环排序、置顶、导入导出
- 大盘指数仅在「自选」展示（含日经225、韩国KOSPI 等可选）
- 分时 / 日周月 K：分时与主力资金默认全日轴到 15:00，可切「已走」
- 止损提醒：详情设止损价；支撑位可手填或自动估算（已去掉压力位）
- 资金页：沪深主力资金、主力意图启发式、板块与涨跌榜、北向资金说明、趣味命名
- 简讯弹窗：实时简析（大盘）· 消息 · 事件日历；约 2 分钟刷新；重大消息标红；未读角标
- 基金实时估值：东财 FundMNFInfo + 天天基金 fundgz（网页 JSONP）

## 说明

行情与快讯来自东方财富等公开接口，仅供学习与个人参考，**不构成投资建议**。CPI 日期为常用区间近似，请以官方日历为准。
