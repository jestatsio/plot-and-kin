import { describe, it, expect } from 'vitest';
import { HistoryQuestConnector, SanbornConnector } from '../src/connectors.js';
import type { SafeFetch } from '../src/network.js';
const json = (data: unknown) => ({bytes:Buffer.from(JSON.stringify(data)),contentType:'application/json',url:'https://example.com',status:200});
describe('DC source connectors', () => {
  it('escapes address SQL and retains complete source records without identity claims', async () => {
    const calls: string[] = [];
    const fetcher: SafeFetch = async url => { calls.push(String(url)); return json({features:[{attributes:{ADDRESS:"1 O'CONNOR ST",OWNER:'Someone',PERMITNUMBER:'42'},geometry:{x:1,y:2}}]}); };
    const result = await new HistoryQuestConnector(fetcher).lookup("1 O'Connor St");
    expect(new URL(calls[0]!).searchParams.get('where')).toContain("O''CONNOR");
    expect(result.records[0]?.attributes.PERMITNUMBER).toBe('42');
    expect(result.attribution).toContain('Brian Kraft');
    expect(result.sourceType).toBe('compiled-dataset');
  });
  it('surfaces ArcGIS errors and marks bounded result truncation', async () => {
    await expect(new HistoryQuestConnector(async () => json({error:{code:429,message:'Busy'}})).lookup('x')).rejects.toMatchObject({code:'CONNECTOR_ERROR'});
    const r= await new HistoryQuestConnector(async () => json({features:[{attributes:{OBJECTID:1}}],exceededTransferLimit:true})).lookup('x',{limit:1});
    expect(r.truncated).toBe(true);
  });
  it('retains map extent and rights without pretending the boundary layer is raster data', async () => {
    let requested='';
    const result=await new SanbornConnector(async url => { if (String(url).includes('/export?')) { requested=String(url); return json({href:'https://maps2.dcgis.dc.gov/dcgis/rest/directories/arcgisoutput/map.png',width:1024,height:1024,extent:{xmin:1,ymin:2,xmax:3,ymax:4,spatialReference:{wkid:3857}}}); } return {bytes:Buffer.from([137,80,78,71,13,10,26,10]),contentType:'image/png',url:String(url),status:200}; }).excerpt({bbox:[-77.01,38.89,-77,38.9]});
    expect(new URL(requested).searchParams.has('layers')).toBe(false);
    expect(result.bbox).toEqual([-77.01,38.89,-77,38.9]);
    expect(result.rights).toContain('not established');
    await expect(new SanbornConnector().excerpt({bbox:[0,0,0,0]})).rejects.toThrow();
  });
});
