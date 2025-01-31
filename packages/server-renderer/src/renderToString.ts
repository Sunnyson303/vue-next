import {
  App,
  createApp,
  createVNode,
  ssrContextKey,
  ssrUtils,
  VNode
} from 'vue'
import { isPromise, isString } from '@vue/shared'
import { SSRContext, renderComponentVNode, SSRBuffer } from './render'

const { isVNode } = ssrUtils

async function unrollBuffer(buffer: SSRBuffer): Promise<string> {
  if (buffer.hasAsync) {
    let ret = ''
    for (let i = 0; i < buffer.length; i++) {
      let item = buffer[i]
      if (isPromise(item)) {
        item = await item
      }
      if (isString(item)) {
        ret += item
      } else {
        ret += await unrollBuffer(item)
      }
    }
    return ret
  } else {
    // sync buffer can be more efficiently unrolled without unnecessary await
    // ticks
    return unrollBufferSync(buffer)
  }
}

/**
 * buffer 数组拼接成字符串
 * @param buffer 
 * @returns 
 */
function unrollBufferSync(buffer: SSRBuffer): string {
  let ret = ''
  for (let i = 0; i < buffer.length; i++) {
    let item = buffer[i]
    if (isString(item)) {
      ret += item
    } else {
      // since this is a sync buffer, child buffers are never promises
      ret += unrollBufferSync(item as SSRBuffer)
    }
  }
  return ret
}

export async function renderToString(
  input: App | VNode,
  context: SSRContext = {}
): Promise<string> {
  // 如果是原始的 vnode ，需要包装为 app 实例，重新调用 renderToString 方法
  if (isVNode(input)) {
    // raw vnode, wrap with app (for context)
    return renderToString(createApp({ render: () => input }), context)
  }

  // rendering an app
  // 创建实例的组件 vnode
  const vnode = createVNode(input._component, input._props)
  vnode.appContext = input._context
  // provide the ssr context to the tree
  input.provide(ssrContextKey, context)
  // vnode 渲染成字符串
  const buffer = await renderComponentVNode(vnode)

  await resolveTeleports(context)

  // 多维数据打平
  return unrollBuffer(buffer as SSRBuffer)
}

async function resolveTeleports(context: SSRContext) {
  if (context.__teleportBuffers) {
    context.teleports = context.teleports || {}
    for (const key in context.__teleportBuffers) {
      // note: it's OK to await sequentially here because the Promises were
      // created eagerly in parallel.
      context.teleports[key] = await unrollBuffer(
        (await Promise.all(context.__teleportBuffers[key])) as SSRBuffer
      )
    }
  }
}
