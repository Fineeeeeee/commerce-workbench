export function deadlineNotice(deadline:string|null|undefined,status:string,now=Date.now()):string|null {
  if(!deadline||['COMPLETED','CANCELLED','CANCELED','已完成','已取消'].includes(status))return null;
  const due=Date.parse(deadline);if(!Number.isFinite(due)||now<=due)return null;
  const days=Math.floor((now-due)/86400000);
  return days?`已逾期 ${days} 天`:'已逾期';
}
