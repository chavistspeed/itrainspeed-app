export const seriesKey = g => JSON.stringify([g.latest.test_id,g.latest.unit,g.latest.protocol,g.latest.direction])
export const chartDate = date => new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}).format(new Date(`${date}T00:00:00Z`))
export function progressChart(rows,width=640) {
 const left=72,right=width-24,top=28,bottom=220
 if(!rows.length)return null
 const dates=rows.map(r=>Date.parse(`${r.tested_at}T00:00:00Z`)),values=rows.map(r=>Number(r.value))
 const minDate=Math.min(...dates),maxDate=Math.max(...dates),min=Math.min(...values),max=Math.max(...values)
 const padding=Math.max((max-min)*.18,Math.abs(max)*.03,.01)
 const low=Math.max(0,min-padding),high=max+padding
 const x=date=>maxDate===minDate?(left+right)/2:left+(date-minDate)/(maxDate-minDate)*(right-left)
 const y=value=>bottom-(value-low)/(high-low)*(bottom-top)
 const points=rows.map((r,i)=>({...r,x:x(dates[i]),y:y(values[i])}))
 const unique=[...new Set(rows.map(r=>r.tested_at))]
 const tickCount=Math.min(unique.length,width<480?2:4)
 const xTicks=Array.from({length:tickCount},(_,i)=>unique[tickCount===1?0:Math.round(i*(unique.length-1)/(tickCount-1))]).map(date=>({date,x:x(Date.parse(`${date}T00:00:00Z`))}))
 return {width,height:280,left,right,top,bottom,points,xTicks,yTicks:Array.from({length:4},(_,i)=>{const value=low+i*(high-low)/3;return {value,y:y(value)}}),path:points.map((p,i)=>`${i?'L':'M'}${p.x},${p.y}`).join(' '),y}
}
