import type {AcademicPlugin,Result,ErrorCode,AuthState,Term,Terms,Schedule,ScheduleEntry,Calendar,Grade,Grades,Exam,HttpRequest,HttpResponse,HostSdk} from '../../../sdk/index';

/** 重庆城市职业学院 · 超星综合教学管理系统（jw.cqcvc.edu.cn）独立适配。
 * 协议已于真实账号只读探测验证（见 README「真实验证结论」）；不处理任何写入操作。
 * 已知宿主缺口：学校 WAF 按 UA 拦截，App 固定 ZhengfangAcademicPlugin/1 会被403（PluginHost.kt）。
 */

const ORIGIN='https://jw.cqcvc.edu.cn';
const LOGIN=`${ORIGIN}/admin/login`;
const IDENTITY=`${ORIGIN}/admin/xsd/xk/listV2`;
const CURRENT_TERM=`${ORIGIN}/admin/xsd/xsdcjcx/getCurrentXnxq`;
const GRADES_FRAME=`${ORIGIN}/admin/xsd/xsdcjcx/qbcjcx`;
const PKZC=`${ORIGIN}/admin/getCurrentPkZc`;
const SCHEDULE_URL=`${ORIGIN}/admin/getXsdSykb`;
const GRADES_URL=`${ORIGIN}/admin/xsd/xsdcjcx/xsdQueryXscjList?fxbz=0&gridtype=jqgrid`;
const GPA_URL=`${ORIGIN}/admin/xsd/xsdzgcjcx/getXspjxfjd`;
const EXAMS_URL=`${ORIGIN}/admin/xsd/kwglXsdKscx/ajaxXsksList?gridtype=jqgrid`;

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

const ok=<T>(data:T):Result<T>=>({ok:true,data});
const err=<T>(code:ErrorCode,message:string):Result<T>=>({ok:false,error:{code,message}});

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
  for(const key of Object.keys(headers))if(key.toLowerCase()===name)return headers[key];
  return'';
};

/** 判断一次响应是否表示「未登录 / 被打回登录页」（兼容302/303 跳转与已跟随两种宿主行为）。 */
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

/** 发起一次受控请求并解析 JSON；网络/HTTP/解析错误统一转成协议错误。 */
const fetchJson=async(s:HostSdk,req:HttpRequest):Promise<JsonReply>=>{
  let res:HttpResponse;
  try{res=await s.http(req);}catch{return{ok:false,error:{code:'NETWORK_RETRYABLE',message:'网络请求未完成'}};}
  if(res.status<200||res.status>=300)return{ok:false,error:{code:'NETWORK_RETRYABLE',message:`服务器返回 HTTP ${res.status}`}};
  try{return{ok:true,payload:JSON.parse(res.body),res};}catch{return{ok:false,error:{code:'VALIDATION_FAILED',message:'服务器返回的数据无法识别'}};}
};

/** 解析周次字符串，如 "1-16周"、"1-8周,10"、"1-16双周"；缺省视为全学期（本校课表接口不返回周次，回退即网页端行为）。 */
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

/** 读取本校学生身份：listV2 在非选课期也返回 xsxh / xsxm（真实响应已验证字段存在）。 */
const readIdentity=async(s:HostSdk):Promise<{studentId:string;studentName:string}|null>=>{
  try{
    const res=await s.http({url:IDENTITY,method:'POST',purpose:'query',headers:JSON_HEADERS,body:'{}'});
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

/** 学期列表：成绩页框架 select#startXnxq 的下拉选项即学年学期（value=2026-2027-1 形态，已真实验证）。 */
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
      const term:Term={id:value,name:value};
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
    /** 表单登录：先取登录页（真实浏览器流程），密码用平台共用 RSA 公钥加密后提交；Cookie 由宿主管理。 */
    start:async(a,c,s)=>{
      try{await s.http({url:LOGIN,method:'GET',purpose:'auth',headers:{'Accept':'text/html'}});}catch{/* 预取失败不阻断登录 */}
      let enc:string;
      try{enc=await s.crypto.rsaEncrypt(RSA_PUBLIC_KEY,a.password);}catch{return err('VALIDATION_FAILED','密码加密失败');}
      let res:HttpResponse;
      try{
        res=await s.http({url:LOGIN,method:'POST',purpose:'auth',form:{username:a.username,password:enc,jcaptchaCode:'',rememberMe:'1'}});
      }catch{return err('INVALID_CREDENTIALS','登录请求未完成，请稍后重试');}
      if(res.status>=500)return err('NETWORK_RETRYABLE','学校服务器暂时不可用');
      if(res.status>=400||pointsToLogin(res))return err('INVALID_CREDENTIALS','学号或密码错误');
      const identity=await readIdentity(s);
      if(!identity)return err('INVALID_CREDENTIALS','登录失败：服务器未建立会话');
      await s.state.set('cqcvc.identity',identity);
      await s.log('info','cqcvc login succeeded');
      return ok<AuthState>({status:'authenticated',studentId:identity.studentId,studentName:identity.studentName});
    },
    /** 本校登录不使用验证码或网页续接，续接入口不可达。 */
    resume:()=>err('UNSUPPORTED','本校登录不使用验证码或网页续接'),
    refreshCaptcha:()=>err('UNSUPPORTED','本校登录不需要验证码'),
    /** 会话校验：探测当前学年学期接口，被重定向到登录页即会话过期。 */
    validate:async(a,c,s)=>{
      let res:HttpResponse;
      try{res=await s.http({url:CURRENT_TERM,method:'GET',purpose:'query',headers:AJAX_HEADERS});}
      catch{return err('SESSION_EXPIRED','会话已失效，请重新登录');}
      if(res.status===401||res.status===403||pointsToLogin(res))return err('SESSION_EXPIRED','会话已失效，请重新登录');
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
    /** 学期列表：成绩页框架下拉选项 + getCurrentXnxq（真实验证：选项 value 即成绩接口参数格式）。 */
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
    /** 课表：getCurrentPkZc 取周数（真实值20），getXsdSykb 取当前学期课表（真实响应无周次字段，按全学期处理）。 */
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
      // 真·周次数据源（与网页课表同源）：课表页隐藏域取 xhid/xqdm → sdpkkbList
      const skCells:{day:number;period:number;kcmc:string;weeks:number[]}[]=[];
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
          const skR=await fetchJson(s,{url:`${ORIGIN}/admin/pkgl/xskb/sdpkkbList?xnxq=${encodeURIComponent(a.termId)}&xhid=${encodeURIComponent(xhid)}&xqdm=${encodeURIComponent(hiddenValue('xqdm'))}&zdzc=&zxzc=&xskbxslx=0`,method:'GET',purpose:'query',headers:AJAX_HEADERS});
          if(skR.ok&&Array.isArray(skR.payload?.data)){
            for(const row of skR.payload.data){
              const day=Number(row?.xingqi);
              const period=Number(row?.djc);
              const kcmc=String(row?.kcmc??'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').trim();
              if(!Number.isFinite(day)||day<1||day>7||!Number.isFinite(period)||period<1||!kcmc)continue;
              skCells.push({day,period,kcmc,weeks:parseWeeks(row?.zcstr??row?.zc,maxWeeks)});
            }
          }
        }
      }catch{/* 周次源不可用 → 各单元回退全学期 */}
      const weeksFor=(day:number,period:number,kcmc:string):number[]|null=>{
        let best:{period:number;weeks:number[]}|null=null;
        for(const c of skCells){
          if(c.day===day&&c.kcmc===kcmc&&c.period<=period&&(!best||c.period>best.period))best=c;
        }
        return best?best.weeks:null;
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
              const weeks=weeksFor(day,period,name)??parseWeeks(course?.zcstr??dayBlock?.zcstr??block?.zcstr,maxWeeks);
              const draft:Omit<ScheduleEntry,'id'>={name,day,startPeriod:period,endPeriod:period,weeks};
              if(teacher)draft.teacher=teacher;
              if(location)draft.location=location;
              drafts.push(draft);
            }
          }
        }
      }
      drafts.sort((x,y)=>x.day-y.day||x.startPeriod-y.startPeriod||x.name.localeCompare(y.name));
      const merged:Array<Omit<ScheduleEntry,'id'>>=[];
      for(const draft of drafts){
        const prev=merged[merged.length-1];
        if(prev&&prev.day===draft.day&&prev.endPeriod+1===draft.startPeriod&&
          prev.name===draft.name&&(prev.teacher??'')===(draft.teacher??'')&&
          (prev.location??'')===(draft.location??'')&&prev.weeks.join(',')===draft.weeks.join(','))
          prev.endPeriod=draft.endPeriod;
        else merged.push({...draft,weeks:[...draft.weeks]});
      }
      const entries=merged.map((e,i)=>({...e,id:`e${i+1}`}));
      return ok<Schedule>({termId:a.termId,maxWeeks,entries});
    },
    /** 作息：本校10 节次时间表为静态配置（已与真实课表 kssj/jssj 逐节核对一致）。 */
    calendar:(a)=>ok<Calendar>({termId:a.termId,periods:PERIODS.map(p=>({number:p.number,start:p.start,end:p.end}))}),
    /** 成绩：jqGrid 分页 + 平均学分绩点；startXnxq/endXnxq 即完整学年学期串（真实验证）。 */
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
    /** 考试安排：jqGrid 分页；该接口无学期参数，返回当前会话可见的全部考试（真实探测 ret=0）。 */
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
  }
} satisfies AcademicPlugin;
