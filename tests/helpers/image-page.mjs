// Browser boundary mock for checklist unit tests. The local-browser suites
// separately verify scroll/readiness and that these metrics reflect real pixels.
export function measuredImagePage(images) {
  return {
    evaluateHandle: async () => ({ dispose: async () => {} }),
    locator: () => ({ scrollIntoViewIfNeeded: async () => {}, locator: () => ({ count: async () => 1, scrollIntoViewIfNeeded: async () => {} }) }),
    waitForFunction: async () => {},
    evaluate: async (reader) => {
      if (reader.name === 'restoreImageScroll') return true;
      if (reader.name === 'readInstanceStructure') return { rootFound:true, images:images.map((image,index)=>({ ...image,path:`img:nth-child(${index+1})` })) };
      if (reader.name === 'readPrimaryImageMetrics') return images.map((image,index)=>({ path:`img:nth-child(${index+1})`,kind:'image', loaded:true,
        natural:{width:image.ratio*100,height:100,ratio:image.ratio},elementBox:{ratio:image.ratio},
        rendered:{ratio:image.ratio,centered:image.centered} }));
      return {start:0,end:0,step:500};
    },
  };
}
