import type { DesignPage, ProductInput } from './domain.js';

export const xml = (value: string) => value.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

// Use a consistent CJK-aware line budget for both browser previews and export.
export function wrap(value: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split('\n')) {
    let line = ''; let used = 0;
    for (const char of paragraph) {
      const size = char.codePointAt(0)! > 255 ? 1 : 0.58;
      if (used + size > width) { lines.push(line); line = ''; used = 0; }
      line += char; used += size;
    }
    lines.push(line);
  }
  return lines;
}
function lines(value: string, x: number, y: number, size: number, width: number, color: string, weight = 400) {
  return `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}">${wrap(value, width).map((line, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : size * 1.4}">${xml(line)}</tspan>`).join('')}</text>`;
}
export function renderSvg(page: DesignPage, product: ProductInput, imageData: string | null, visualData: string | null = null): string {
  const h = page.kind === 'main' ? 1080 : 1440;
  if(page.visualMode==='REFERENCE_IMAGE'&&visualData)return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${h}" viewBox="0 0 1080 ${h}"><image href="${xml(visualData)}" width="1080" height="${h}" preserveAspectRatio="xMidYMid meet"/></svg>`;
  const dark = page.accent;
  const side = page.layout === 'editorial';
  const baseSize = side ? 500 : page.kind === 'main' ? 550 : 650;
  const structuredPage = ['F02','D03','D09'].includes(page.templateId ?? '');
  const photoSize = (structuredPage ? 370 : baseSize) * page.productScale;
  const photoX = structuredPage ? 600 : side ? 510 + (500 - photoSize) / 2 : (1080 - photoSize) / 2;
  const photoY = structuredPage ? 300 : 320;
  const textY = page.kind === 'main' ? 970 : 1090;
  const backdrop = page.layout === 'focus' ? `<circle cx="540" cy="640" r="400" fill="${dark}" opacity=".06"/>` : `<path d="M0 ${h * .68} Q540 ${h * .48} 1080 ${h * .72} V${h} H0Z" fill="${dark}" opacity=".035"/>`;
  const visual = visualData ? `<image href="${xml(visualData)}" x="0" y="0" width="1080" height="${h}" preserveAspectRatio="xMidYMid slice"/><rect width="1080" height="${h}" fill="${page.background}" opacity=".10"/>` : `<rect width="1080" height="${h}" fill="${page.background}"/>${backdrop}`;
  const bodyItems = page.body.split('\n').filter(Boolean);
  if(page.templateId==='F01'){
    const sellingPoints=page.body.split(/[·｜\n]/).map(item=>item.trim()).filter(Boolean),badgeOne=sellingPoints[0]??'核心卖点',badgeTwo=sellingPoints[1]??product.specification,bottom=sellingPoints.slice(2,5).join(' · ')||sellingPoints.join(' · ');
    const audience=product.audience.replace(/\s*[（(][^）)]*(?:提供|来源)[^）)]*[）)]\s*/g,'').trim();
    const audienceLabel=audience ? `适用${audience}` : '日常洗护';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">${visual}<g font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif">
      <text x="70" y="72" fill="${dark}" font-family="Georgia,serif" font-size="28" letter-spacing="5">${xml(product.brand)}</text>
      <text x="70" y="108" fill="${dark}" font-family="Georgia,serif" font-size="12" letter-spacing="3" opacity=".72">STREAMSIDE ORCHID FRAGRANCE</text>
      ${lines(page.headline,70,178,62,14,dark,700)}
      <rect x="70" y="218" width="610" height="48" rx="24" fill="${dark}" opacity=".88"/>
      <text x="94" y="250" fill="white" font-size="22">${xml(audienceLabel)}</text>
      <g transform="translate(145 420)"><circle r="68" fill="white" opacity=".9"/><circle r="61" fill="none" stroke="${dark}" stroke-width="2" opacity=".35"/><text y="8" text-anchor="middle" fill="${dark}" font-size="28" font-weight="600">${xml(badgeOne)}</text></g>
      <g transform="translate(155 585)"><circle r="58" fill="${dark}" opacity=".9"/><text y="7" text-anchor="middle" fill="white" font-size="24" font-weight="600">${xml(badgeTwo)}</text></g>
      ${imageData?`<image href="${xml(imageData)}" x="360" y="275" width="580" height="580" preserveAspectRatio="xMidYMid meet"/>`:''}
      <rect x="0" y="878" width="1080" height="202" fill="${dark}" opacity=".93"/>
      <text x="70" y="938" fill="white" font-size="25" opacity=".8">DAILY HAIR CARE</text>
      <text x="70" y="992" fill="white" font-size="34" font-weight="600">${xml(bottom)}</text>
      <rect x="840" y="914" width="170" height="58" rx="29" fill="white" opacity=".96"/>
      <text x="925" y="952" text-anchor="middle" fill="${dark}" font-size="29" font-weight="700">${xml(product.specification)}</text>
      <text x="70" y="1042" fill="white" font-size="18" opacity=".8">${xml(product.name)}</text>
    </g></svg>`;
  }
  const cards = ['F02','D03'].includes(page.templateId ?? '') ? bodyItems.slice(0,4).map((item,i) => `<g transform="translate(${70 + (i%2)*480} ${720 + Math.floor(i/2)*105})"><rect width="430" height="82" rx="18" fill="white" opacity=".86"/><circle cx="40" cy="41" r="22" fill="${dark}" opacity=".12"/><text x="40" y="49" text-anchor="middle" fill="${dark}" font-size="18">${i+1}</text>${lines(item,78,34,21,16,dark,500)}</g>`).join('') : '';
  const steps = page.templateId === 'D09' ? bodyItems.slice(0,5).map((item,i) => `<g transform="translate(90 ${760+i*105})"><circle cx="34" cy="34" r="30" fill="${dark}"/><text x="34" y="43" text-anchor="middle" fill="white" font-size="24">${i+1}</text>${lines(item.replace(/^\d+[.、]\s*/,''),88,26,24,30,dark,500)}</g>`).join('') : '';
  const structured = cards || steps;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${h}" viewBox="0 0 1080 ${h}">${visual}<g font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif">
    <text x="70" y="78" fill="${dark}" font-family="Georgia,serif" font-size="32" letter-spacing="4">${xml(product.brand)}</text>
    <line x1="70" x2="1010" y1="105" y2="105" stroke="${dark}" opacity=".15"/>
    ${lines(page.headline, 70, 185, 52, 18, dark, 600)}
    ${lines(page.subtitle, 72, 270, 23, 37, dark)}
    ${imageData ? `<image href="${xml(imageData)}" x="${photoX}" y="${photoY}" width="${photoSize}" height="${photoSize}" preserveAspectRatio="xMidYMid meet"/>` : `<rect x="${photoX}" y="${photoY}" width="${photoSize}" height="${photoSize}" rx="24" fill="white"/><text x="540" y="610" text-anchor="middle" fill="#89999b" font-size="24">请选择商品素材</text>`}
    ${structured || (side ? `${lines(product.specification, 70, 500, 46, 8, dark, 500)}${lines(page.body, 70, 590, 25, 13, dark)}` : lines(page.body, 90, textY, 26, 33, dark))}
    <line x1="70" x2="1010" y1="${h - 78}" y2="${h - 78}" stroke="${dark}" opacity=".15"/>
    <text x="70" y="${h - 38}" fill="${dark}" font-size="19">${xml(product.name)}</text>
    <text x="1010" y="${h - 38}" text-anchor="end" fill="${dark}" font-size="19">${xml(product.specification)}</text>
  </g></svg>`;
}

export function layoutIssues(page: DesignPage): string[] {
  const errors: string[] = [];
  if (wrap(page.headline, 18).length > 1) errors.push('主标题过长，请缩短至单行（约 18 个汉字）');
  if (wrap(page.subtitle, 37).length > 1) errors.push('副标题超出单行区域');
  const maxBodyLines = page.layout === 'editorial' ? (page.kind === 'main' ? 10 : 18) : page.kind === 'main' ? 1 : 6;
  if (wrap(page.body, page.layout === 'editorial' ? 13 : 33).length > maxBodyLines) errors.push('正文超出版式空间，请缩短或切换版式');
  return errors;
}
