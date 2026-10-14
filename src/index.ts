import type {AcademicPlugin,Result,ErrorCode,AuthState,Term,Terms,Schedule,ScheduleEntry,Calendar,Grade,Grades,Exam,Round,Course,Section,Enrollment,Page,PageQuery,SelectionReceipt,SelectionFilters,HttpRequest,HttpResponse,HostSdk} from '../../../sdk/index';

const ORIGIN='https://jw.cqcvc.edu.cn';
const LOGIN=`${ORIGIN}/admin/login`;
const IDENTITY=`${ORIGIN}/admin/xsd/xk/listV2`;
const CURRENT_TERM=`${ORIGIN}/admin/xsd/xsdcjcx/getCurrentXnxq`;
const GRADES_FRAME=`${ORIGIN}/admin/xsd/xsdcjcx/qbcjcx`;
const PKZC=`${ORIGIN}/admin/getCurrentPkZc`;
const XQLIST=`${ORIGIN}/admin/api/jcsj/xqsj/getXqList`;
const SCHEDULE_URL=`${ORIGIN}/admin/getXsdSykb`;
const GRADES_URL=`${ORIGIN}/admin/xsd/xsdcjcx/xsdQueryXscjList?fxbz=0&gridtype=jqgrid`;
const GPA_URL=`${ORIGIN}/admin/xsd/xsdzgcjcx/getXspjxfjd`;
const EXAMS_URL=`${ORIGIN}/admin/xsd/kwglXsdKscx/ajaxXsksList?gridtype=jqgrid`;
/* 选课（2026-10-13 专项抓包 + 2026-10-14 真实账号只读实测） */
const XK_BOOT=`${ORIGIN}/admin/xsd/xk/listV2`;
const XK_JXB=`${ORIGIN}/admin/xsd/xk/listjxbDataV2`;
const XK_CHILD=`${ORIGIN}/admin/xsd/xk/queryChildClassesV2`;
const XK_ENROLLED=`${ORIGIN}/admin/xsd/yxkccx/listYxkc?gridtype=jqgrid&async=1`;
const XK_SELECT=`${ORIGIN}/admin/xsd/xk/xsdXkV2`;
const XK_DROP=`${ORIGIN}/admin/xsd/xk/xsdTkV2`;

/** 超星综合教务系统全平台共用的 RSA 公钥（SPKI DER Base64，PKCS1v15）——已与登录页源码核对一致。 */
const RSA_PUBLIC_KEY='MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCwC58ftEM2SJHu2H/IIF7DfAi74AtaQSXjGy9PWEb5qD2s0+uh+n1YZBEKDBwwLWZL6T2wVC26pGJuniTOPzGxe5ARTwMATsGKkDTKVNNxkZWxZJS8tuxlJoNP9RD5/u9H3wYJKxcv4VsnH1CwFqlEq7NihIjxvwk7F0omsIbphwIDAQAB';

const JSON_HEADERS:Record<string,string>={'X-Requested-With':'XMLHttpRequest','Accept':'application/json','Content-Type':'application/json'};
const AJAX_HEADERS:Record<string,string>={'X-Requested-With':'XMLHttpRequest','Accept':'application/json'};

/** 课程性质字典（逆向文档第13.1 节，本校专属）。 */
const KCXZ:Record<string,string>={'01':'公共必修课','02':'第二课堂','03':'学科基础课','04':'专业核心课','05':'专业拓展课','06':'顶岗实习','07':'军训','08':'实习实训','12':'专业基础课','17':'通识选修课','99':'公共选修课'};

/** 本校10 节次作息时间表——已与课表接口返回的 kssj/jssj 实测逐节核对一致。 */
const PERIODS:{number:number;start:string;end:string}[]=[
  {number:1,start:'08:20',end:'09:05'},
  {number:2,start:'09:15',end:'10:00'},
  {number:3,start:'10:30',end:'11:15'},
  {number:4,start:'11:25',end:'12:10'},
  {number:5,start:'14:00',end:'14:45'},
  {number:6,start:'14:55',end:'15:40'},
  {number:7,start:'16:10',end:'16:55'},
  {number:8,start:'17:05',end:'17:50'},
  {number:9,start:'19:30',end:'20:15'},
  {number:10,start:'20:25',end:'21:10'}
];

/** 由 getZclistByXnxq 的 data.jcsjszList 生成作息表——作息按「校区 xqid + 学期」绑定，
 * 各校/各学期节次数与时间都可能不同，接口下发比内置表可靠；拿不到时上层回退内置表。
 * 实测条目：{"kssj":"8:20","jssj":"9:05","jc":"1","xnxq":"2026-2027-1","xqid":"00001",…}（kssj 不补零，统一补成 HH:MM）。 */
const readPeriods=(raw:unknown):{number:number;start:string;end:string}[]=>{
  if(!Array.isArray(raw))return[];
  const norm=(t:string):string=>{
    const m=/^(\d{1,2}):(\d{1,2})$/.exec(t.trim());
    return m?`${m[1].padStart(2,'0')}:${m[2].padStart(2,'0')}`:'';
  };
  const out:{number:number;start:string;end:string}[]=[];
  for(const row of raw){
    if(!row||typeof row!=='object')continue;
    const number=Number((row as{jc?:unknown}).jc);
    const start=norm(String((row as{kssj?:unknown}).kssj??''));
    const end=norm(String((row as{jssj?:unknown}).jssj??''));
    if(!Number.isFinite(number)||number<1||number>30||!start||!end)continue;
    if(out.some(p=>p.number===number))continue;
    out.push({number,start,end});
  }
  out.sort((x,y)=>x.number-y.number);
  return out;
};

/** 校区 id：作息/周历按「校区 xqid + 学期」绑定，不带 xqid 时 getZclistByXnxq 只回 dqzc（实测）。
 * 优先用课表页隐藏域 xqdm（study.schedule 缓存），否则问 getXqList（实测 1 项：id=00001 永川）。 */
const readCampusId=async(s:HostSdk):Promise<string>=>{
  const cached=await s.state.get<string>('cqcvc.xqdm');
  if(cached)return cached;
  try{
    const res=await s.http({url:XQLIST,method:'GET',purpose:'query',headers:AJAX_HEADERS});
    if(pointsToLogin(res)||res.status<200||res.status>=300)return'';
    const payload=JSON.parse(res.body);
    const first=Array.isArray(payload?.data)?payload.data[0]:null;
    const id=String(first?.id??'').trim();
    if(id)await s.state.set('cqcvc.xqdm',id);
    return id;
  }catch{return'';}
};

/** 选课初始化：listV2 一次带回批次（mapsList，xkgzid 即 pcid）与每批次加密串（pcencs）。 */
const readSelectionBootstrap=async(s:HostSdk):Promise<{rounds:Round[];pcenc:Record<string,string>;termId:string}|null>=>{
  try{
    const r=await fetchJson(s,{url:XK_BOOT,method:'POST',purpose:'query',headers:JSON_HEADERS});
    if(!r.ok)return null;
    const d=r.payload&&typeof r.payload.data==='object'&&r.payload.data?r.payload.data:null;
    if(!d)return null;
    const pcenc:Record<string,string>={};
    if(d.pcencs&&typeof d.pcencs==='object')for(const k of Object.keys(d.pcencs))pcenc[k]=String((d.pcencs as Record<string,unknown>)[k]);
    const termId=String(d.xkxnxq??'').trim();
    const rounds:Round[]=[];
    for(const m of Array.isArray(d.mapsList)?d.mapsList:[]){
      if(!m||typeof m!=='object')continue;
      const id=String((m as{xkgzid?:unknown}).xkgzid??'').trim();
      if(!id)continue;
      const name=String((m as{xkgzMc?:unknown}).xkgzMc??'').trim()||id;
      rounds.push({id,name,termId,open:String((m as{sfkxk?:unknown}).sfkxk??'')!=='0'});
    }
    return{rounds,pcenc,termId};
  }catch{return null;}
};

/** 选课筛选的 revision（与账号/提供者/批次绑定的不透明串）。 */
const conflictRevision=(roundId:string)=>`cqcvc-conflict-v1:${roundId}`;

/** 宿主调用 select/drop 时常常只给 sectionId/enrollmentId，不带 roundId —— 此时用 listV2 的当前批次兜底（pcid 必填，学校会报「pcid 为空」）。 */
const resolveRoundId=async(a:{roundId?:string},s:HostSdk):Promise<string>=>{
  const rid=String(a.roundId??'').trim();
  if(rid)return rid;
  const boot=await readSelectionBootstrap(s);
  return boot?.rounds[0]?.id??'';
};

/** 选课接口一次返回全量（本校单批次 ≤ 几十条），按 SDK 的 Page 协议切页。 */
const pageOf=<T>(all:T[],q:PageQuery):Page<T>=>{
  const size=q.pageSize&&q.pageSize>0?Math.min(200,Math.floor(q.pageSize)):20;
  const start=q.cursor?Math.max(0,Number(q.cursor)||0):0;
  const items=all.slice(start,start+size);
  const out:Page<T>={items};
  if(start+size<all.length)out.nextCursor=String(start+size);
  return out;
};

const ok=<T>(data:T):Result<T>=>({ok:true,data});
// details 供真机诊断：宿主的插件诊断面板只透出错误码（不透出 message），所以把分支名与 HTTP 状态写进 details。
const err=<T>(code:ErrorCode,message:string,details?:Record<string,string>):Result<T>=>({ok:false,error:details?{code,message,details}:{code,message}});

/** 取 URL 路径（去 query/hash），不依赖 WHATWG URL（沙箱无 DOM 类型）。 */
const pathOf=(u:string):string=>{
  const i=u.indexOf('://');
  const rest=i>=0?u.slice(i+3):u;
  const slash=rest.indexOf('/');
  const p=slash<0?'/':rest.slice(slash);
  return p.split('?')[0].split('#')[0];
};
const isLoginUrl=(u:string):boolean=>pathOf(u).toLowerCase().endsWith('login');

const headerOf=(res:HttpResponse,name:string):string=>{
  const headers=res.headers??{};
  for(const key of Object.keys(headers))if(key.toLowerCase()===name.toLowerCase())return headers[key];
  return'';
};

/** 解析 HTTP Date（RFC1123）——QuickJS 的 Date.parse 只认 ISO8601，必须手写 */
const parseHttpDate=(s:string):number=>{
  const m=/^(?:\w{3}),?\s*(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+GMT$/.exec(s.trim());
  if(!m)return NaN;
  const months:Record<string,number>={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
  const mon=months[m[2]];
  if(mon===undefined)return NaN;
  return Date.UTC(Number(m[3]),mon,Number(m[1]),Number(m[4]),Number(m[5]),Number(m[6]));
};

const pointsToLogin=(res:HttpResponse):boolean=>{
  if(res.status>=300&&res.status<400){
    const loc=headerOf(res,'location');
    if(!loc)return true;
    const target=loc.indexOf('://')>=0?loc:(loc.charAt(0)==='/'?ORIGIN+loc:`${ORIGIN}/${loc}`);
    return isLoginUrl(target);
  }
  return isLoginUrl(res.url||'');
};

type JsonReply={ok:true;payload:any;res:HttpResponse}|{ok:false;error:{code:ErrorCode;message:string}};

const fetchJson=async(s:HostSdk,req:HttpRequest):Promise<JsonReply>=>{
  let res:HttpResponse;
  try{res=await s.http(req);}catch{return{ok:false,error:{code:'NETWORK_RETRYABLE',message:'网络请求未完成'}};}
  if(res.status<200||res.status>=300)return{ok:false,error:{code:'NETWORK_RETRYABLE',message:`服务器返回 HTTP ${res.status}`}};
  try{return{ok:true,payload:JSON.parse(res.body),res};}catch{return{ok:false,error:{code:'VALIDATION_FAILED',message:'服务器返回的数据无法识别'}};}
};

/** 缺省视为全学期：本校课表接口不返回周次，回退即网页端行为 */
function parseWeeks(raw:unknown,maxWeeks:number):number[]{
  const cap=Math.min(25,Math.max(1,maxWeeks));
  const all=():number[]=>{const out:number[]=[];for(let w=1;w<=cap;w++)out.push(w);return out;};
  const text=typeof raw==='string'?raw.replace(/\s+/g,''):'';
  if(!text||text==='-'||text==='全部'||text==='整学期')return all();
  const set=new Set<number>();
  for(const token of text.split(/[,，、]/)){
    if(!token)continue;
    let m=/^(\d+)-(\d+)(双|单)周?$/.exec(token);
    if(m){
      const a=Number(m[1]),b=Number(m[2]),even=m[3]==='双';
      for(let w=a;w<=b;w++)if(w>=1&&w<=cap&&(even?w%2===0:w%2===1))set.add(w);
      continue;
    }
    m=/^(\d+)-(\d+)(?:周|星期)?$/.exec(token);
    if(m){
      const a=Number(m[1]),b=Number(m[2]);
      for(let w=a;w<=b;w++)if(w>=1&&w<=cap)set.add(w);
      continue;
    }
    m=/^(\d+)周?$/.exec(token);
    if(m){
      const w=Number(m[1]);
      if(w>=1&&w<=cap)set.add(w);
    }
  }
  if(!set.size)return all();
  return Array.from(set).sort((x,y)=>x-y);
}

/** 读取本校学生身份：listV2 在非选课期也返回 xsxh / xsxm。
 * 📌 v1.1.0 曾按抓包去掉请求体，真机（App 1.0.120）上无请求体的 POST 拿不到 xsxh → 登录被判 INVALID_CREDENTIALS；
 * 现在三级降级：带 '{}' → 不带请求体 → getXqList 的 currentUserName（实测即学号）兜底。 */
const readIdentity=async(s:HostSdk):Promise<{studentId:string;studentName:string}|null>=>{
  const fromListV2=async(body:string|undefined):Promise<{studentId:string;studentName:string}|null>=>{
    try{
      const req:HttpRequest={url:IDENTITY,method:'POST',purpose:'query',headers:JSON_HEADERS};
      if(body!==undefined)req.body=body;
      const res=await s.http(req);
      if(pointsToLogin(res))return null;
      const payload=JSON.parse(res.body);
      const d=payload&&typeof payload.data==='object'&&payload.data?payload.data:null;
      if(!d)return null;
      const studentId=String(d.xsxh??'').trim();
      if(!studentId)return null;
      const studentName=String(d.xsxm??'').trim()||studentId;
      return{studentId,studentName};
    }catch{return null;}
  };
  const first=await fromListV2('{}');
  if(first)return first;
  const second=await fromListV2(undefined);
  if(second)return second;
  try{
    const res=await s.http({url:XQLIST,method:'GET',purpose:'query',headers:AJAX_HEADERS});
    if(pointsToLogin(res))return null;
    const payload=JSON.parse(res.body);
    const row=Array.isArray(payload?.data)?payload.data[0]:null;
    const studentId=String(row?.currentUserName??'').trim();
    if(!studentId)return null;
    return{studentId,studentName:studentId};
  }catch{return null;}
};

/** 学期显示名：2026-2027-1 → 2026-2027 第一学期（id 仍用原始 value，接口参数依赖它）。 */
const formatTermName=(v:string):string=>{
  const m=/^(\d{4}-\d{4})-(\d+)$/.exec(v);
  if(!m)return v;
  const n=Number(m[2]);
  const label=n===1?'一':n===2?'二':String(n);
  return `${m[1]} 第${label}学期`;
};

const fetchTermItems=async(s:HostSdk):Promise<{ok:true;items:Term[]}|{ok:false;error:{code:ErrorCode;message:string}}>=>{
  let res:HttpResponse;
  try{res=await s.http({url:GRADES_FRAME,method:'GET',purpose:'query',headers:AJAX_HEADERS});}
  catch{return{ok:false,error:{code:'NETWORK_RETRYABLE',message:'网络请求未完成'}};}
  if(res.status<200||res.status>=300)return{ok:false,error:{code:'NETWORK_RETRYABLE',message:`服务器返回 HTTP ${res.status}`}};
  const html=res.body;
  const select=/<select[^>]*id=["']startXnxq["'][^>]*>([\s\S]*?)<\/select>/i.exec(html);
  const scope=select?select[1]:html;
  const items:Term[]=[];
  const seen=new Set<string>();
  const re=/<option[^>]*value=["']([^"']+)["'][^>]*>[^<]*<\/option>/gi;
  let m=re.exec(scope);
  while(m){
    const value=m[1].trim();
    if(/^\d{4}-\d{4}-\d+$/.test(value)&&!seen.has(value)){
      seen.add(value);
      const term:Term={id:value,name:formatTermName(value)};
      const y=/^(\d{4})-(\d{4})-(\d+)$/.exec(value);
      if(y){term.year=Number(y[1]);term.semester=Math.min(12,Number(y[3]));}
      items.push(term);
    }
    m=re.exec(scope);
  }
  if(!items.length)return{ok:false,error:{code:'VALIDATION_FAILED',message:'未获取到学期列表'}};
  return{ok:true,items};
};

export default {
  auth:{
    /** 先预取登录页——复刻真实浏览器流程（丢弃其响应属正常）。 */
    start:async(a,c,s)=>{
      // 输入先去掉首尾空白：手机粘贴密码容易带空格，会表现为"密码错误"。
      const username=String(a.username??'').trim();
      const password=String(a.password??'');
      if(!username||!password)return err('VALIDATION_FAILED','请输入学号与密码',{stage:'input',usernameEmpty:String(!username),passwordEmpty:String(!password)});
      // 预取登录页复刻真实浏览器（响应丢弃属正常）。
      try{await s.http({url:LOGIN,method:'GET',purpose:'auth',headers:{'Accept':'text/html'}});}catch{/* 预取失败不阻断登录 */}
      let enc:string;
      try{enc=await s.crypto.rsaEncrypt(RSA_PUBLIC_KEY,password);}catch{return err('VALIDATION_FAILED','密码加密失败',{stage:'encrypt'});}
      let res:HttpResponse;
      try{
        // X-Requested-With 与真实可用参考一致（本机脚本用同样报文登录成功）；其余请求头由宿主托管，
        // SDK 契约只放行 accept / content-type / x-requested-with（referer 需 network.request@4，不为此抬门槛）。
        res=await s.http({url:LOGIN,method:'POST',purpose:'auth',headers:{
          'X-Requested-With':'XMLHttpRequest','Accept':'text/html,application/xhtml+xml,*/*;q=0.8'
        },form:{username,password:enc,jcaptchaCode:'',rememberMe:'1'}});
      }catch{return err('NETWORK_RETRYABLE','登录请求未完成，请稍后重试',{stage:'login.post',failure:'http-threw'});}
      // 403 刻意不用 NETWORK_RETRYABLE：宿主诊断面板只导出错误码，把 WAF 拒绝单独映射成 PERMISSION_DENIED。
      if(res.status===403)return err('PERMISSION_DENIED','请求被学校防火墙拦截（HTTP 403），请稍后重试',{stage:'login.post',status:'403'});
      // 被跳回登录页 = 凭据问题（INVALID_CREDENTIALS），不再继续。
      if(res.status>=400&&res.status<500||pointsToLogin(res))return err('INVALID_CREDENTIALS','学号或密码错误（登录请求被跳回登录页）',{stage:'login.post',status:String(res.status),bounced:String(pointsToLogin(res))});
      // 关键：登录 POST 的 302 已经发出会话 Cookie，落地页 5xx 不等于登录失败 ——
      // 先试身份，取不回再按 5xx 报错（真机诊断显示正是"登录成功但落地页 5xx"的形态）。
      const identity=await readIdentity(s);
      if(!identity){
        if(res.status>=500)return err('NETWORK_RETRYABLE',`学校服务器暂时不可用（HTTP ${res.status}）`,{stage:'login.post',status:String(res.status)});
        return err('SESSION_EXPIRED','登录已提交但会话未建立：listV2 与 getXqList 都没拿到学号',{stage:'identity'});
      }
      await s.state.set('cqcvc.identity',identity);
      await s.log('info','cqcvc login succeeded');
      return ok<AuthState>({status:'authenticated',studentId:identity.studentId,studentName:identity.studentName});
    },
    resume:()=>err('UNSUPPORTED','本校登录不使用验证码或网页续接'),
    refreshCaptcha:()=>err('UNSUPPORTED','本校登录不需要验证码'),
    validate:async(a,c,s)=>{
      let res:HttpResponse;
      try{res=await s.http({url:CURRENT_TERM,method:'GET',purpose:'query',headers:AJAX_HEADERS});}
      catch{return err('SESSION_EXPIRED','会话已失效，请重新登录',{stage:'validate',failure:'http-threw'});}
      if(res.status===401||res.status===403||pointsToLogin(res))return err('SESSION_EXPIRED','会话已失效，请重新登录',{stage:'validate',status:String(res.status)});
      const cached=await s.state.get<{studentId:string;studentName:string}>('cqcvc.identity');
      if(cached&&cached.studentId)return ok<AuthState>({status:'authenticated',studentId:cached.studentId,studentName:cached.studentName});
      const identity=await readIdentity(s);
      if(identity){
        await s.state.set('cqcvc.identity',identity);
        return ok<AuthState>({status:'authenticated',studentId:identity.studentId,studentName:identity.studentName});
      }
      return ok<AuthState>({status:'authenticated',studentId:'',studentName:''});
    }
  },
  study:{
    terms:async(a,c,s)=>{
      const list=await fetchTermItems(s);
      if(!list.ok)return{ok:false,error:list.error};
      const curR=await fetchJson(s,{url:CURRENT_TERM,method:'GET',purpose:'query',headers:AJAX_HEADERS});
      if(!curR.ok)return{ok:false,error:curR.error};
      if(Number(curR.payload?.ret)!==0)return err('VALIDATION_FAILED',String(curR.payload?.msg||'当前学期查询失败'));
      const curData=curR.payload?.data;
      const curStr=typeof curData==='string'?curData.trim():'';
      const items=list.items;
      const currentId=(curStr&&items.some(t=>t.id===curStr))?curStr:(items[0]?.id||curStr);
      const ids=items.map(t=>t.id).sort();
      await s.state.set('cqcvc.currentTermId',currentId);
      await s.state.set('cqcvc.termRange',[ids[0],ids[ids.length-1]]);
      return ok<Terms>({items,currentId});
    },
    schedule:async(a,c,s)=>{
      const current=await s.state.get<string>('cqcvc.currentTermId');
      if(current&&a.termId!==current){
        const mw=await s.state.get<number>('cqcvc.maxWeeks');
        return ok<Schedule>({termId:a.termId,entries:[],maxWeeks:mw&&mw>=1&&mw<=25?mw:16});
      }
      const pkR=await fetchJson(s,{url:PKZC,method:'GET',purpose:'query',headers:AJAX_HEADERS});
      if(!pkR.ok)return{ok:false,error:pkR.error};
      const weeksRaw=pkR.payload?.data;
      let maxWeeks=16;
      if(Array.isArray(weeksRaw)){
        let max=0;
        for(const w of weeksRaw){
          const n=Number(w);
          if(Number.isFinite(n)&&n>max)max=n;
        }
        if(max>=1)maxWeeks=Math.min(25,max);
      }
      await s.state.set('cqcvc.maxWeeks',maxWeeks);
      const scR=await fetchJson(s,{url:SCHEDULE_URL,method:'POST',purpose:'query',headers:AJAX_HEADERS,form:{}});
      if(!scR.ok)return{ok:false,error:scR.error};
      const payload=scR.payload;
      if(Number(payload?.ret)!==0)return err('VALIDATION_FAILED',String(payload?.msg||'课表获取失败'));
      const skCells:{day:number;period:number;kcmc:string;room:string;weeks:number[]}[]=[];
      try{
        const pageRes=await s.http({url:`${ORIGIN}/admin/pkgl/xskb/queryKbForXsd?xnxq=${encodeURIComponent(a.termId)}&zxzc=&zdzc=&xskbxslx=0`,method:'GET',purpose:'query',headers:{'Accept':'text/html'}});
        const hiddenValue=(id:string):string=>{
          const tags=pageRes.body.match(/<input[^>]*>/gi)??[];
          for(const tag of tags){
            if(new RegExp(`id=["']${id}["']`,'i').test(tag)){
              const v=/value=["']([^"']*)["']/.exec(tag);
              if(v)return v[1];
            }
          }
          return'';
        };
        const xhid=hiddenValue('xhid');
        if(xhid){
          const xqdm=hiddenValue('xqdm');
          if(xqdm)await s.state.set('cqcvc.xqdm',xqdm);
          const skR=await fetchJson(s,{url:`${ORIGIN}/admin/pkgl/xskb/sdpkkbList?xnxq=${encodeURIComponent(a.termId)}&xhid=${encodeURIComponent(xhid)}&xqdm=${encodeURIComponent(xqdm)}&zdzc=&zxzc=&xskbxslx=0`,method:'GET',purpose:'query',headers:AJAX_HEADERS});
          if(skR.ok&&Array.isArray(skR.payload?.data)){
            for(const row of skR.payload.data){
              const day=Number(row?.xingqi);
              const period=Number(row?.djc);
              const kcmc=String(row?.kcmc??'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').trim();
              if(!Number.isFinite(day)||day<1||day>7||!Number.isFinite(period)||period<1||!kcmc)continue;
              const room=String(row?.croommc??'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').trim();
              skCells.push({day,period,kcmc,room,weeks:parseWeeks(row?.zcstr??row?.zc,maxWeeks)});
            }
          }
        }
      }catch{/* 周次源不可用 → 各单元回退全学期 */}
      const normRoom=(v:string):string=>v.replace(/\s+/g,'').replace(/（/g,'(').replace(/）/g,')').toLowerCase();
      /** 把周次源行贴到网格单元：教室优先——同一格可能有多行（不同教室、不同周次），先到先得会静默丢行。
       * 实测案例：周四第1-2节高数 文华楼125=第15-18周、文华楼521=第4-5周，旧算法取到125行就丢掉521行，第4周课程被漏排。
       * 流程：候选（同星期、剥壳同名、起始节≤目标节）→ 教室命中时收窄到该教室 → 取起始节最大者 → 同起始节多行周次取并集。 */
      const weeksFor=(day:number,period:number,kcmc:string,location:string):number[]|null=>{
        const cands=skCells.filter(c=>c.day===day&&c.kcmc===kcmc&&c.period<=period);
        if(!cands.length)return null;
        const nr=normRoom(location);
        const roomHit=nr?cands.filter(c=>normRoom(c.room)===nr):[];
        const pool=roomHit.length?roomHit:cands;
        let maxP=0;
        for(const c of pool)if(c.period>maxP)maxP=c.period;
        const set=new Set<number>();
        for(const c of pool)if(c.period===maxP)for(const w of c.weeks)set.add(w);
        return Array.from(set).sort((x,y)=>x-y);
      };
      const drafts:Array<Omit<ScheduleEntry,'id'>>=[];
      const blocks=payload?.data?.jcKcxx;
      if(Array.isArray(blocks)){
        for(const block of blocks){
          const period=Number(block?.jc);
          if(!Number.isFinite(period)||period<1||period>30)continue;
          const days=block?.kbxx;
          if(!Array.isArray(days))continue;
          for(const dayBlock of days){
            const day=Number(dayBlock?.yzxq);
            if(!Number.isFinite(day)||day<1||day>7)continue;
            const courses=dayBlock?.kcxx;
            if(!Array.isArray(courses))continue;
            for(const course of courses){
              const name=String(course?.kcmc??'').trim();
              if(!name||name==='-')continue;
              const teacher=String(course?.teacher??'').trim();
              const location=String(course?.classroom??'').trim();
              const weeks=weeksFor(day,period,name,location)??parseWeeks(course?.zcstr??dayBlock?.zcstr??block?.zcstr,maxWeeks);
              const draft:Omit<ScheduleEntry,'id'>={name,day,startPeriod:period,endPeriod:period,weeks};
              if(teacher)draft.teacher=teacher;
              if(location)draft.location=location;
              drafts.push(draft);
            }
          }
        }
      }
      // 合并连续节次：先按（星期, 课程, 教师, 教室, 周次）分组、组内按起始节排序再并段——
      // 旧的「挨着上一条就并」依赖全局排序，同节多课（不同教室）交错时会打断合并。
      const merged:Array<Omit<ScheduleEntry,'id'>>=[];
      {
        const groups=new Map<string,Array<Omit<ScheduleEntry,'id'>>>();
        for(const draft of drafts){
          const key=[draft.day,draft.name,draft.teacher??'',draft.location??'',draft.weeks.join(',')].join('\u0001');
          const arr=groups.get(key);
          if(arr)arr.push(draft);else groups.set(key,[draft]);
        }
        for(const arr of groups.values()){
          arr.sort((x,y)=>x.startPeriod-y.startPeriod);
          let cur:Omit<ScheduleEntry,'id'>|null=null;
          for(const draft of arr){
            if(cur&&cur.endPeriod+1===draft.startPeriod)cur.endPeriod=draft.endPeriod;
            else{cur={...draft,weeks:[...draft.weeks]};merged.push(cur);}
          }
        }
        merged.sort((x,y)=>x.day-y.day||x.startPeriod-y.startPeriod||x.name.localeCompare(y.name)||String(x.location??'').localeCompare(String(y.location??'')));
      }
      const entries=merged.map((e,i)=>({...e,id:`e${i+1}`}));
      return ok<Schedule>({termId:a.termId,maxWeeks,entries});
    },
    calendar:async(a,c,s)=>{
      // 数据源：getZclistByXnxq?xnxq=&role=&userId=&xqid= —— 实测 data 有 5 个键：
      //   jcsjszList（校区+学期绑定的节次作息）、zclist（**权威周历**：zc/minrq/maxrq/rqfw）、
      //   jsxq（排课设置）、dqzc（当前第几周）、kbxssj。不带 xqid 时只回 dqzc，作息与周历都会丢。
      // 开学日期优先取 zclist[0].minrq（本校第一周不是完整周，见下），缺周历时才退回公式推算。
      const current=await s.state.get<string>('cqcvc.currentTermId');
      const isCurrent=!current||current===a.termId;
      let periods=PERIODS.map(p=>({number:p.number,start:p.start,end:p.end}));
      let startDate:string|undefined;
      try{
        const campus=await readCampusId(s);
        const query=campus?`?xnxq=${encodeURIComponent(a.termId)}&role=&userId=&xqid=${encodeURIComponent(campus)}`:'';
        const res=await s.http({url:`${ORIGIN}/admin/api/getZclistByXnxq${query}`,method:'GET',purpose:'query',headers:AJAX_HEADERS});
        if(!pointsToLogin(res)&&res.status>=200&&res.status<300){
          const payload=JSON.parse(res.body);
          const data=payload&&typeof payload.data==='object'&&payload.data?payload.data:null;
          if(data){
            const dynamic=readPeriods(data.jcsjszList);
            if(dynamic.length)periods=dynamic;
          }
          if(isCurrent){
            const weeks=Array.isArray(data?.zclist)?data.zclist:null;
            const first=weeks&&weeks.length?String(weeks[0]?.minrq??''): '';
            const exact=/^(\d{4}-\d{2}-\d{2})/.exec(first.trim());
            if(exact)startDate=exact[1];
            else{
              // 兜底公式：开学日 = 服务器本周一 − (dqzc−1) 周——仅当第一周是完整周时准确。
              const dq=Number(data?.dqzc);
              const ms=parseHttpDate(headerOf(res,'Date'));
              if(Number.isFinite(dq)&&dq>=1&&Number.isFinite(ms)){
                const cn=ms+8*3600*1000;
                const weekMonday=cn-((new Date(cn).getUTCDay()+6)%7)*86400000-(dq-1)*7*86400000;
                const d=new Date(weekMonday);
                const pad=(n:number)=>String(n).padStart(2,'0');
                startDate=`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
              }
            }
          }
        }
      }catch{/* 推算失败则不提供 startDate，作息回退内置表 */}
      const value:Calendar={termId:a.termId,periods};
      if(startDate)value.startDate=startDate;
      return ok(value);
    },
    grades:async(a,c,s)=>{
      const pn=a.cursor?Math.max(1,Number(a.cursor)||1):1;
      const size=a.pageSize&&a.pageSize>0?Math.min(500,Math.floor(a.pageSize)):20;
      let start='';let end='';
      if(a.termId){start=a.termId;end=a.termId;}
      else{
        const range=await s.state.get<[string,string]>('cqcvc.termRange');
        if(range&&range[0]&&range[1]){start=range[0];end=range[1];}
        else{
          const list=await fetchTermItems(s);
          if(!list.ok)return{ok:false,error:list.error};
          const ids=list.items.map(t=>t.id).sort();
          start=ids[0];end=ids[ids.length-1];
          await s.state.set('cqcvc.termRange',[start,end]);
        }
      }
      const form:Record<string,string>={'page.pn':String(pn),'page.size':String(size),startXnxq:start,endXnxq:end,sort:'xnxq',order:'desc'};
      const gR=await fetchJson(s,{url:GRADES_URL,method:'POST',purpose:'query',headers:AJAX_HEADERS,form});
      if(!gR.ok)return{ok:false,error:gR.error};
      const payload=gR.payload;
      if(Number(payload?.ret)!==0)return err('VALIDATION_FAILED',String(payload?.msg||'成绩查询失败'));
      const rows=Array.isArray(payload?.results)?payload.results:[];
      const items:Grade[]=[];
      let credits=0;let creditsFound=false;
      for(let i=0;i<rows.length;i++){
        const row=rows[i];
        if(!row||typeof row!=='object')continue;
        const name=String(row.kcmc??'').trim();
        if(!name)continue;
        const grade:Grade={id:String(row.id??'').trim()||`${pn}-${i+1}`,name,score:String(row.zhcj??row.fxcj??'')};
        const xf=String(row.xf??'').trim();if(xf)grade.credits=xf;
        const jd=String(row.jd??'').trim();if(jd)grade.gradePoint=jd;
        const kcxz=String(row.kcxz??'').trim();if(kcxz)grade.type=KCXZ[kcxz]??kcxz;
        const xnxq=String(row.xnxq??'').trim();if(xnxq)grade.termId=xnxq;
        const college=String(row.kkyxmc??'').trim();if(college)grade.college=college;
        items.push(grade);
        const hdxf=Number(String(row.hdxf??'').trim());
        if(Number.isFinite(hdxf)&&String(row.sfbk??'')==='0'){credits+=hdxf;creditsFound=true;}
      }
      const result:Grades={items};
      const totalPages=Number(payload?.totalPages);
      if(Number.isFinite(totalPages)&&pn<totalPages)result.nextCursor=String(pn+1);
      const gpaR=await fetchJson(s,{url:GPA_URL,method:'GET',purpose:'query',headers:AJAX_HEADERS});
      if(gpaR.ok){
        const gpa=String(gpaR.payload?.data??'').trim();
        if(/^\d+(\.\d+)?$/.test(gpa))result.gradePointAverage=gpa;
      }
      if(creditsFound)result.totalCredits=String(Number(credits.toFixed(2)));
      return ok(result);
    },
    /** 该接口无学期参数，返回当前会话可见的全部考试（真实探测 ret=0）。 */
    exams:async(a,c,s)=>{
      const pn=a.cursor?Math.max(1,Number(a.cursor)||1):1;
      const size=a.pageSize&&a.pageSize>0?Math.min(500,Math.floor(a.pageSize)):50;
      const form:Record<string,string>={
        queryFields:'id,kspcmc,xh,xm,kcmc,kssj,jsmc,ksfs,ksxs,zwh,bkcs,bz,rwbz,',
        _search:'false','page.size':String(size),'page.pn':String(pn),
        sort:'bjdm asc,zwh asc,id',order:'asc'
      };
      const r=await fetchJson(s,{url:EXAMS_URL,method:'POST',purpose:'query',headers:AJAX_HEADERS,form});
      if(!r.ok)return{ok:false,error:r.error};
      const payload=r.payload;
      if(Number(payload?.ret)!==0)return err('VALIDATION_FAILED',String(payload?.msg||'考试查询失败'));
      const rows=Array.isArray(payload?.results)?payload.results:[];
      const items:Exam[]=[];
      for(let i=0;i<rows.length;i++){
        const row=rows[i];
        if(!row||typeof row!=='object')continue;
        const name=String(row.kcmc??'').trim();
        const time=String(row.kssj??'').trim();
        if(!name||!time)continue;
        const exam:Exam={id:String(row.id??'').trim()||`${pn}-${i+1}`,name,time};
        const location=String(row.jsmc??'').trim();if(location)exam.location=location;
        const seat=String(row.zwh??'').trim();if(seat)exam.seat=seat;
        const scene=String(row.kspcmc??'').trim();if(scene)exam.examName=scene;
        items.push(exam);
      }
      const out:{items:Exam[];nextCursor?:string}={items};
      const totalPages=Number(payload?.totalPages);
      if(Number.isFinite(totalPages)&&pn<totalPages)out.nextCursor=String(pn+1);
      return ok(out);
    }
  },
  /** 选课整组（SDK 契约要求 auth/selection 整组替换，六方法齐全）。协议来自 2026-10-13 选课专项抓包 + 2026-10-14 真实账号只读实测。
   * 映射：Round←listV2.mapsList（xkgzid=pcid）· Course←listjxbDataV2.initData · Section←queryChildClassesV2.extend.zjxb（无子班时即教学班自身）
   *      · Enrollment←已选课程查询 listYxkc · select/drop←xsdXkV2 / xsdTkV2（purpose=mutation，需用户确认） */
  selection:{
    /** 可选筛选（App 97+）：学校网页有「过滤冲突教学班」勾选，这里把它做成 App 里的筛选项。 */
    filters:async(a,c,s)=>{
      const boot=await readSelectionBootstrap(s);
      if(!boot)return err('NETWORK_RETRYABLE','选课批次获取失败，请稍后重试');
      const roundId=String(a.roundId??'');
      if(!roundId||!boot.rounds.some(r=>r.id===roundId))return err('VALIDATION_FAILED','未知的选课批次');
      return ok<SelectionFilters>({roundId,revision:conflictRevision(roundId),groups:[
        {id:'conflict',label:'课程冲突',kind:'multi',options:[
          {value:'hide',label:'隐藏冲突教学班（与已选课程时间冲突）'}
        ]}
      ]});
    },
    catalog:async(a,c,s)=>{
      const boot=await readSelectionBootstrap(s);
      if(!boot)return err('NETWORK_RETRYABLE','选课批次获取失败，请稍后重试');
      return ok(pageOf(boot.rounds,a));
    },
    courses:async(a,c,s)=>{
      const boot=await readSelectionBootstrap(s);
      if(!boot)return err('NETWORK_RETRYABLE','选课批次获取失败，请稍后重试');
      const roundId=String(a.roundId??'');
      // revision 与账号/提供者/批次绑定；过期或跨批次的筛选值必须重新加载（SDK 契约要求）
      if(a.filters&&String(a.filters.revision??'')!==conflictRevision(roundId))return err('PAGE_CHANGED','筛选条件已过期，请重新加载筛选项');
      const form:Record<string,string>={
        from:'jhxk',kcmc:String(a.keyword??''),teacher:String(a.teacher??''),jxbmc:'',
        glymjxb:'',glctjxb:'',kcxz:'',jxms:'',kcgs:'',kclb:'',kclx:'',kkxq:'',
        pcid:roundId,pcenc:boot.pcenc[roundId]??''
      };
      const r=await fetchJson(s,{url:XK_JXB,method:'POST',purpose:'query',headers:AJAX_HEADERS,form});
      if(!r.ok)return{ok:false,error:r.error};
      if(Number(r.payload?.ret)!==0)return err('VALIDATION_FAILED',String(r.payload?.msg||'课程列表获取失败'));
      const rows=Array.isArray(r.payload?.data?.initData)?r.payload.data.initData:[];
      // 选课筛选（App 97+ 的 selection.filters）：目前只有「隐藏冲突教学班」，行为与学校网页的同名勾选一致。
      // sfct 是学校下发的冲突标记（0=未冲突），status 0=未选；只有"未选且冲突"才该被过滤或标注。
      const hideConflict=a.filters?.values?.conflict?.includes('hide')===true;
      const items:Course[]=[];
      for(const row of rows){
        if(!row||typeof row!=='object')continue;
        const name=String(row.kcmc??'').trim();
        if(!name)continue;
        const conflicted=String(row.sfct??'0')!=='0'&&String(row.status??'')==='0';
        if(hideConflict&&conflicted)continue;
        const id=String(row.id??'').trim()||`c${items.length+1}`;
        const course:Course={id,name,roundId,sectionId:id};
        const teacher=String(row.teacher??'').trim();if(teacher)course.teacher=teacher;
        const time=String(row.sksjdd??'').trim();if(time&&time!=='--/--')course.time=time;
        const credits=String(row.xf??'').trim();if(credits)course.credits=credits;
        const capacity=Number(String(row.yxrl??'').trim());if(Number.isFinite(capacity)&&capacity>0)course.capacity=capacity;
        const selected=Number(String(row.bjrs??'').trim());if(Number.isFinite(selected))course.selected=selected;
        const jxbmc=String(row.jxbmc??'').trim();
        // SDK 的 Course 没有冲突字段，冲突标记只能拼进 sectionName 才能被 App 显示出来
        if(jxbmc)course.sectionName=conflicted?`${jxbmc}（时间冲突）`:jxbmc;
        items.push(course);
      }
      return ok(pageOf(items,a));
    },
    sections:async(a,c,s)=>{
      const boot=await readSelectionBootstrap(s);
      if(!boot)return err('NETWORK_RETRYABLE','选课批次获取失败，请稍后重试');
      const r=await fetchJson(s,{url:XK_CHILD,method:'POST',purpose:'query',headers:AJAX_HEADERS,
        form:{jxbid:String(a.courseId??''),pcid:String(a.roundId??''),pcenc:boot.pcenc[String(a.roundId??'')]??'',from:'jhxk'}});
      if(r.ok&&Number(r.payload?.ret)===0){
        const kids:any[]=Array.isArray(r.payload?.extend?.zjxb)?r.payload.extend.zjxb:[];
        if(kids.length){
          const items:Section[]=[];
          for(let i=0;i<kids.length;i++){
            const row:any=kids[i];
            if(!row||typeof row!=='object')continue;
            const id=String(row.id??row.jxbid??'').trim()||`s${i+1}`;
            const sec:Section={id,courseId:String(a.courseId??'')};
            const name=String(row.jxbmc??row.name??'').trim();if(name)sec.name=name;
            items.push(sec);
          }
          if(items.length)return ok<Page<Section>>({items});
        }
      }
      // 本校当前批次的教学班没有子班（实测 sfyzjxb 全为 0）→单教学班即课程自身，不再多打一次请求
      return ok<Page<Section>>({items:[{id:String(a.courseId??''),courseId:String(a.courseId??'')}]});
    },
    enrolled:async(a,c,s)=>{
      const pn=a.cursor?Math.max(1,Number(a.cursor)||1):1;
      const size=a.pageSize&&a.pageSize>0?Math.min(200,Math.floor(a.pageSize)):50;
      const r=await fetchJson(s,{url:`${XK_ENROLLED}&page.pn=${pn}&page.size=${size}&sort=id&order=asc&_search=false`,method:'GET',purpose:'query',headers:AJAX_HEADERS});
      if(!r.ok)return{ok:false,error:r.error};
      if(Number(r.payload?.ret)!==0)return err('VALIDATION_FAILED',String(r.payload?.msg||'已选课程获取失败'));
      const rows=Array.isArray(r.payload?.results)?r.payload.results:[];
      const items:Enrollment[]=[];
      for(let i=0;i<rows.length;i++){
        const row=rows[i];
        if(!row||typeof row!=='object')continue;
        const name=String(row.kcmc??'').trim();
        if(!name)continue;
        const id=String(row.id??'').trim()||`e${i+1}`;
        const item:Enrollment={id,courseId:String(row.kcid??'').trim()||id,sectionId:id,name};
        const teacher=String(row.rkjs??'').trim();if(teacher)item.teacher=teacher;
        const time=String(row.sksjdd??'').trim();if(time&&time!=='--/--')item.time=time;
        const credits=String(row.xf??'').trim();if(credits)item.credits=credits;
        items.push(item);
      }
      const out:Page<Enrollment>={items};
      const totalPages=Number(r.payload?.totalPages);
      if(Number.isFinite(totalPages)&&pn<totalPages)out.nextCursor=String(pn+1);
      return ok(out);
    },
    select:async(a,c,s)=>{
      const pcid=await resolveRoundId(a,s);
      if(!pcid)return err('NOT_OPEN','当前没有可操作的选课批次，请稍后再试');
      const jxbid=String(a.sectionId||a.courseId||'');
      // 冲突二次确认（学校真实协议）：与已报名课程时间冲突时，后端返回 ret=0 + extend.needConfirm=true，
      // 必须由学生确认后带 sfqc=1 重发才真正选上。不处理会把"待确认"误报成"已选上"。
      const pending=await s.state.get<{jxbid:string;pcid:string}>('cqcvc.pendingConfirm');
      const form:Record<string,string>={jxbid,pcid};
      if(pending&&pending.jxbid===jxbid&&pending.pcid===pcid)form.sfqc='1';
      const r=await fetchJson(s,{url:XK_SELECT,method:'POST',purpose:'mutation',headers:AJAX_HEADERS,form});
      if(!r.ok)return{ok:false,error:r.error};
      const payload=r.payload;
      const msg=String(payload?.msg??'').trim();
      if(Number(payload?.ret)!==0)return err('VALIDATION_FAILED',msg||'选课失败');
      const extend=payload&&typeof payload.extend==='object'&&payload.extend?payload.extend:null;
      if(extend&&(extend as{needConfirm?:unknown}).needConfirm){
        await s.state.set('cqcvc.pendingConfirm',{jxbid,pcid});
        return ok<SelectionReceipt>({confirmed:false,message:msg||'与已报名课程时间冲突，请确认后再次提交'});
      }
      await s.state.remove('cqcvc.pendingConfirm');
      return ok<SelectionReceipt>({confirmed:true,message:msg||'选课成功'});
    },
    drop:async(a,c,s)=>{
      const pcid=await resolveRoundId(a,s);
      if(!pcid)return err('NOT_OPEN','当前没有可操作的选课批次，请稍后再试');
      const r=await fetchJson(s,{url:XK_DROP,method:'POST',purpose:'mutation',headers:AJAX_HEADERS,
        form:{jxbid:String(a.enrollmentId||a.sectionId||a.courseId||''),pcid}});
      if(!r.ok)return{ok:false,error:r.error};
      const msg=String(r.payload?.msg??'').trim();
      if(Number(r.payload?.ret)!==0)return err('VALIDATION_FAILED',msg||'退课失败');
      return ok<SelectionReceipt>({confirmed:true,message:msg||'退课成功'});
    }
  }
} satisfies AcademicPlugin;
