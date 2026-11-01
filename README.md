# yyyhhh

> 我们的照片，摊在时间里。

一个只为两个人存在的恋爱纪念站。打开第一眼是一个一直在跳的数字——在一起多少天多少小时；底部三格导航通向留言板、相册和计划清单。

---

## 它长什么样

**首页**——一个精确到秒的计时器，天、时、分、秒各占一格，每秒跳一次。下面一行小字写着起点。除此之外什么都没有，这一页只做一件事。它**不依赖网络**：Supabase 挂了、慢十秒，进来看到的仍然是那个在动的数字。

**相册**——按天分组的纵向时间轴，一天一块，最新的一天在最上面。点任意一张进入沉浸视图，从缩略图原位放大；左右翻的是整条时间线。照片可以写简介、标星、删除。

**留言板**——不挂在任何一张照片上的便签墙。两个人的日常。输入框吸在顶部（手机弹键盘时不会被遮住），下面是一片淡色便签，颜色由 id 算出来，同一句话永远是同一种颜色。

**计划清单**——「去英国旅行」这种。只有标题和一个勾：勾上就沉到「已经做过了」，划一道横线。这里刻意没有目标日期、没有分类、没有备注，它是一张写着期待的纸，不是任务管理系统。

**两个主题**——`奶油`（暖米白、奶咖文字）与`莓奶`（淡粉奶油底），随时切换，会记住你的选择。整体走低对比、大圆角、弥散阴影的柔和调子；进入沉浸视图时背景沉成暖暗色，照片像在暗房里发光。

---

## 快速开始

```bash
npm install
npm run dev
```

打开 http://127.0.0.1:5173 即可。**什么都不配置也能用**——会自动进入「本地模式」，照片和留言都存在当前浏览器里（图片走 IndexedDB，绕开 localStorage 的 5MB 限制），适合先把玩和试看。

---

## 接入 Supabase（让两个人共享同一份相册）

本地模式下你的手机和她的手机是两个互不相干的相册。要共享，必须要有一个后端，这里用 Supabase 免费版。

1. 到 [supabase.com](https://supabase.com) 新建一个项目（免费，不需要信用卡）。
2. 打开 **SQL Editor**，把 [`supabase/schema.sql`](supabase/schema.sql) 整段粘进去执行。它会建表、开 RLS、创建 `photos` 存储桶。
3. 到 **Project Settings → API** 复制 `Project URL` 和 `anon public key`。
4. 复制 `.env.example` 为 `.env.local`，填进去：

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

5. 重启 `npm run dev`。右上角的「本地模式」标记会消失，此时两台设备打开同一个网址看到的就是同一份相册。

> **已经建过库的**：`schema.sql` 末尾那一段「2026-11 · 站级留言板 + 计划清单」是后加的，可以单独复制粘贴执行（幂等 `if not exists` / `drop policy if exists`）。不跑它的话，留言板和计划清单会一直显示「没读出来」——照片相册不受影响。

**填完先自检一次**：

```bash
npm run check
```

它会只读地检查一遍：URL 格式对不对、key 是不是用错了 secret、两张表建没建、RLS 策略通不通、`photos` 存储桶是否公开。哪一步不对会直接告诉你该改什么，比在浏览器里对着「本地模式」猜要快得多。

免费额度：1GB 文件存储 + 500MB 数据库。因为是浏览器端压两档上传（560px 缩略图 + 1800px 大图，WebP），**1GB 大约能放 3500–4500 张**。

相册时间轴上永远用 560 缩略图（竖版手机上 358px 宽、2 倍屏要 716px，560 略欠一点，但 timeline 里一张图占大半屏，换 1800 只是把首屏拖慢），点开详情才换成 1800 大图。所以列表滚得快，看大图才吃流量。

这两档尺寸在 2026-10-26 从 720 / 2048 改小，只对新上传的照片生效。存量照片用 `scripts/recompress-photos.mjs` 重压一遍（先跑不带参数的试算，加 `--write` 才真写）。它靠 `schema.sql` 里那条 `photo objects updatable` 策略才能覆盖同名对象，**跑完必须同步把 `public/sw.js` 的 `IMG_FULL` / `IMG_THUMB` 版本号升一档**——图片缓存是 CacheFirst，不换桶就会一直吐旧字节。

---

## 部署到 GitHub Pages

1. 推到 GitHub 的 `main` 分支。
2. 仓库 **Settings → Pages → Source** 选 **GitHub Actions**。
3. 仓库 **Settings → Secrets and variables → Actions** 添加两个 secret：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. 之后每次 push 到 `main` 都会自动构建部署，`.github/workflows/deploy.yml` 已经写好。

> 构建时用 `base: './'`，所以部署在 `https://用户名.github.io/仓库名/` 这种子路径下也能正常加载资源。

---

## 离线缓存（Service Worker）

`public/sw.js` 是一份手写模板，`scripts/build-sw.mjs` 在构建时把版本号和预缓存清单填进去。它做三件事：

| 资源 | 策略 |
|---|---|
| 页面（导航） | 先要网络，3.5 秒没回来就用缓存；离线也打得开 |
| 构建产物（JS / CSS / 图片） | 预缓存，文件名带内容哈希，永不改变 |
| Storage 里的照片 | 优先用缓存，按条数封顶（大图 60、缩略图 200） |
| **`rest/v1` 的接口** | **一律不拦** |

最后一条是刻意的：留言写成功那一刻只有应用知道哪个 photoId 脏了，Service Worker 拿不到这个语义。让它缓存接口，只会让留言板在「读不到」和「真的没有」之间撒谎。接口数据由 `src/lib/albumCache.ts` 这一层负责（首屏先显示上次的快照，同时后台刷新）。

**一条必须守住的约定**：照片的 `storage_key` 是随机 UUID，上传用 `upsert: false`，所以**同名对象永远不会有第二份内容**——这是"照片可以永久缓存"的前提。以后想换掉某张照片，请生成新的 `storage_key`；在 Supabase 面板里手动覆盖同名文件，会让已经缓存过的设备一直看到旧图。

本地验证要用 `npm run preview`（dev server 下不注册）。想看子路径下的表现：

```bash
mkdir -p tmp/LoveStory && cp -r dist/* tmp/LoveStory/
python -m http.server 8080 -d tmp   # 打开 http://127.0.0.1:8080/LoveStory/
```

要彻底下线 Service Worker，**不要**直接删注册代码——已经装过它的设备再也没机会收到通知了。正确顺序是把 `scripts/sw-kill.js` 复制成 `dist/sw.js` 部署一次，等一个发布周期（GitHub Pages 的缓存是 10 分钟，保守等一天），再从 `src/main.tsx` 删掉注册那段。

---

## 交互

| 操作 | 桌面 | 手机 |
|---|---|---|
| 回首页 | 点页头那个 `yyyhhh`，或再点一次当前标签 | 同（另外系统返回键也能逐级退回） |
| 看大图 | 点相册里任意一张 | 点按 |
| 左右翻 | `←` `→` | 左右滑动 |
| 留言（挂在照片下） | 详情页右侧面板 | 窗口底部「留言」抽屉 |
| 删除照片 | 详情页右上角垃圾桶，**按两下**（第一下变红） | 同 |
| 那年今日 | 相册页顶部的一条横幅，点开就是往年今天那几张 | 同 |

计时器是**自校准**的：每次把下一次唤醒对齐到整秒（而不是固定 `setInterval(1000)` 那样一路累积漂移），所以贴着手机时钟看不别扭；从后台切回来会立刻纠正一次，不会停在一个旧数字上。切到别的标签、拉起相册，都不会让它重渲染——时钟的 state 只活在 `TogetherTimer` 这一个叶子组件里。

**点开一张照片是一次放大，不是一次淡入**：从缩略图当前位置飞到展示位置，两者像素级对齐，看不出接缝。飞行期间底色层（`.viewer-wash`）是**不透明**的——半透明会让底下的页面和详情页标题叠成两层字——但它会从页面底色渐变成暗色，读起来是「灯慢慢暗下来」而不是硬切。序号、按钮、留言栏晚 0.24~0.3s 再淡入，视线先跟着照片。系统开了「减少动态效果」时不飞，直接呈现。

飞行层只动 `transform`，不动 `border-radius`：后者不是合成属性，放进关键帧会让浏览器每一帧重绘整张照片（连阴影一起）。飞行期间氛围层也不渲染——它是一块 2340×2340 的合成层，和飞行层撞在同一帧就是那一下卡顿。

**那年今日**：往年同月同日的照片，会在相册页顶部摆一条横幅（「2 年前的今天 · 3 张」），点开就顺着看下去。不点就一直在那儿躺着，点 × 当天不再出现。今年的不算——那叫今天；闰日严格匹配，今天 2/29 就只找 2/29，不拿 2/28 凑数。

---

## 打不开的时候，你看到什么

这个站最怕的一种误解是「照片没了」。所以界面被刻意分成四种状态，任何一种都不会让人得出那个结论：

| 状态 | 长什么样 | 说明 |
|---|---|---|
| 加载中 | 一条呼吸的细线 +「正在翻开相册」 | 只占相册页的内容区，页头和导航照常可用 |
| 连不上 | 「相册暂时没打开」+ **照片都还在，只是这会儿读不到** + 「再试一次」 | 附原因、原始报错与 Restore 提示 |
| 真的空 | 时间线位置上的「还什么都没有」+「放第一张」 | 只有照片确实是 0 张时才出现 |
| 页面崩了 | 「这一页没排好」+「再试一次」/「刷新页面」 | 错误边界兜住，不会白屏 |
| 操作没成 | 底部一条提示（星标 / 简介 / 删除 / 留言 / 计划各一句），界面已经回滚 | 见下一段 |

错误边界分三层挂：整页（`main.tsx`）、页面内容区、详情页。**某一页崩了页头和底部导航还在**，另外两页照常能去；**某一张照片打不开**只关掉那一页，回相册换一张就行。展开「看看原因」能看到原始报错和组件栈，排查时不用猜。

星标、改简介、删照片、勾计划都是**先改界面、再发请求**——等一个来回网络请求再变界面会明显发木。代价是请求可能失败，所以每一条都做了回滚：失败时界面退回原样，底部补一句「星标没存上，再点一次试试」。改简介失败还会**留在编辑态**，草稿不会丢。

留言发不出去时，输入框上方会出现一条提示，草稿留着，再点一次「贴上」就行；留言读不出来也和「还没有留言」分开显示，带「再试一次」。计划清单的勾**必须**在数据库里有对应的 update 策略，缺了它 PostgREST 会返回 204 且不报错，所以仓储层会拿回被改的行数来反查——没有行就当作失败。

---

## 数据结构

```sql
photos         (id, storage_key, width, height, aspect, taken_at, caption,
                featured_at, created_at, deleted_at)
messages       (id, photo_id, content, created_at, deleted_at)
board_messages (id, content, created_at, deleted_at)
plans          (id, title, done_at, created_at, deleted_at)
```

`messages` 和 `board_messages` 是两张表、两套语义，别合并：前者是「某一张照片下面说的话」（`photo_id` 必填），后者是「平时想说的话」。

两个刻意的设计：

- **`storage_key` 而不是完整 URL**。数据库里只存目录名，图片地址在 `src/lib/repo/supabase.ts` 里统一拼出来。将来 1GB 不够了要换 Cloudflare R2 或腾讯云 COS，只改这一处，业务代码一行不动。
- **`deleted_at` / `done_at` 而不是布尔或真删**。`deleted_at` 打时间戳就看不见了，行还在表里；`done_at` 非空就是「已完成」，和 `photos.featured_at` 同一套约定。时间戳比布尔多留了一条信息：什么时候完成的。

注意一个连带的取舍：**删照片只隐藏记录，图片文件仍留在 Storage 里**。因为一旦给匿名用户开放 `storage.objects` 的 delete 权限，任何人就能真删图片、绕过软删除。所以这里选择了宁可多占一点空间，也不给破坏留下入口。空间实在紧张时，去 Storage 页面手动清理无主的目录即可。

---

## 删除就是删掉了

界面里**没有回收站，也没有撤销**。删掉的照片不会出现在任何地方，站点里也没有入口能把它找回来。

唯一的缓冲是删除动作本身要按两下：详情页右上角的垃圾桶，第一下图标变红并提示「再点一次确认」，**3.2 秒内**再点一下才真的删；不点就自动复位。这几秒就是全部的保护。

数据库层面仍然是软删除——`deleted_at` 打一个时间戳，行留在表里。它带来两件事：

- 页面上所有查询都过滤掉 `deleted_at is not null` 的记录，所以看不见；
- **真要找回只能进 Supabase 后台手工改数据**，前端不提供这个能力，两个人的相册也不该为一次手滑常驻一个回收站。

万一确实误删了，去 SQL Editor 跑这两句：

```sql
-- 1. 列出被删掉的照片，最近的在前
select id, taken_at, caption, deleted_at
from public.photos
where deleted_at is not null
order by deleted_at desc;

-- 2. 把上一步查到的 id 填进去，它就回到时间轴上原来那天的位置
update public.photos set deleted_at = null where id = '粘贴上一步的 id';
```

位置是算出来的（由 `taken_at` 决定），不是存下来的，所以恢复后和删除前一模一样。图片文件也从没被删过——软删除不动 Storage——恢复不需要重新上传。

所以请按这个前提使用：**按完两下，那张就没了。** 想留住的东西，靠后面「定期备份」那一节，比什么都稳。

---

## 关于「不做鉴权」

按需求，这个站**不做登录**：任何人打开网页都能上传照片、改简介、留言。前提是「网址基本没人知道」。配合这条前提，代码里做了两道保险：

1. **删除在数据库层面是软删除**，被删的行不会真的消失。但要说清楚：**界面上没有回收站，也没有撤销**，被匿名访客删掉的照片当场就看不见了，找回得自己进 Supabase 改数据（语句见上一节）。这道保险防的是「数据彻底没了」，不是「点了就能反悔」。
2. **上传的图片是双档压缩的**，不存原图，所以即使被灌入垃圾图片，消耗也有限。

风险要说清楚：Supabase 的 anon key 必然打包在前端，任何人按 F12 都能拿到。**如果哪天链接被转发或被搜索引擎收录，相册内容就可能被陌生人改动。** 那一刻的正确做法是去 Supabase 把 RLS 里的 `photos insertable / updatable` 和 `messages insertable` 三条策略删掉，站点立刻变成只读，内容丝毫不会丢。

### 定期备份

Supabase 免费版**不提供自动备份**。建议每隔一段时间到 SQL Editor 跑一次：

```sql
select jsonb_pretty(jsonb_agg(to_jsonb(p) order by p.taken_at)) from public.photos p;
select jsonb_pretty(jsonb_agg(to_jsonb(m) order by m.created_at)) from public.messages m;
```

把结果另存为 `.json` 就是一份完整备份。这两句**没有过滤 `deleted_at`**，所以删掉的照片也在里面——它同时也是「误删之后唯一一份不依赖后台操作的底」。图片本体在 Storage 里，可以在 Storage 页面整桶下载。

---

## 目录结构

```
src/
├── lib/
│   ├── types.ts           数据模型与 Repo 接口
│   ├── timer.ts           在一起的起点 + 时长拆分（纯函数）
│   ├── days.ts            按天分组、拍时间排序（时间轴用）
│   ├── image.ts           EXIF 读取 + 双档压缩（不依赖第三方库）
│   ├── format.ts          时间格式化、稳定哈希
│   ├── errors.ts          把原始报错翻成人话
│   ├── throwback.ts       那年今日：往年同月同日的照片
│   ├── flight.ts          起点矩形、飞行时长、减少动效判断
│   ├── presence.ts        延迟卸载，让弹层演完退场动画
│   ├── preload.ts         预取并解码相邻照片（换图不等下载）
│   ├── albumCache.ts      上一次的相册快照，让二次访问不用等接口
│   ├── scrollLock.ts      弹层打开时锁住页面滚动
│   └── repo/
│       ├── index.ts       有配置走 Supabase，没有就退回本地
│       ├── local.ts       localStorage + IndexedDB
│       └── supabase.ts    Postgres + Storage
├── hooks/
│   ├── useRoute.ts        hash 路由（#/ #/album #/board #/plans）
│   ├── useAlbum.ts        相册状态与增删改
│   ├── useBoard.ts        站级留言板
│   ├── usePlans.ts        计划清单
│   └── useImgUrl.ts       图片地址的同步读 + 异步补
├── components/
│   ├── pages/             四个页面：Home / Album / Board / Plans
│   ├── TogetherTimer.tsx  首页那个每秒跳动的计时器（唯一每秒重渲染的组件）
│   ├── TimelineItem.tsx   时间轴上的一张照片
│   ├── BottomNav.tsx      底部三个按钮
│   ├── PageHeader.tsx     页头（品牌名兼回首页）+ 主题开关
│   ├── Viewer.tsx         沉浸视图（大图、翻页、改简介、星标、删除）
│   ├── MessageBoard.tsx   单张照片下面的便签留言
│   ├── UploadSheet.tsx    上传面板
│   ├── FlightPhoto.tsx    从缩略图飞向详情页的那张图（FLIP）
│   ├── ScreenStates.tsx   加载中 / 连不上的状态块
│   └── ErrorBoundary.tsx  渲染错误兜底（整页 / 页面内容区 / 详情页）
├── App.tsx                主题、路由、相册数据、全局浮层
└── index.css              双主题变量 + 全部视觉细节
supabase/schema.sql        一键建表、RLS、存储桶
public/sw.js               Service Worker 模板（构建时注入版本与清单）
scripts/build-sw.mjs       扫 dist 生成预缓存清单
scripts/sw-kill.js         紧急下线 Service Worker 用（手动复制进 dist）
scripts/check-supabase.mjs 检查环境变量是否配好
.github/workflows/deploy.yml
```

三处最常改的地方：

- **起点日期**：`src/lib/timer.ts` 的 `START_AT`。必须用数字构造（`new Date(2025, 2, 17)`），写字符串 `'2025-03-17'` 会被当成 UTC，东八区差 8 小时。
- **时间轴方向**：`AlbumPage` 里的 `groupByDay(photos, 'desc')`，改成 `'asc'` 就从故事开头读起。
- **页面骨架**：`App.tsx` 一个 switch 决定渲染哪个页面，加第四个标签只需要在 `useRoute` 的表里加一行 + `BottomNav` 加一项。
