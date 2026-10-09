export function elapsedLabel(start:string,end:string):string{
  const first=Date.parse(start),last=Date.parse(end);
  if(!Number.isFinite(first)||!Number.isFinite(last)||last<first)return '用时待核实';
  const seconds=Math.floor((last-first)/1000);
  if(seconds<60)return `${seconds} 秒`;
  if(seconds<3600)return `${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;
  return `${Math.floor(seconds/3600)} 小时 ${Math.floor(seconds%3600/60)} 分`;
}
