import { Application } from '../src/application'
import { Context } from '../src/context'
import { GitHubApp } from '../src/github-app'
import { logger } from '../src/logger'

describe('Application', () => {
  let adapter: GitHubApp
  let app: Application
  let event: any
  let output: any

  beforeAll(() => {
    // Add a new stream for testing the logger
    // https://github.com/trentm/node-bunyan#adding-a-stream
    logger.addStream({
      level: 'trace',
      stream: { write: (log: any) => output.push(log) },
      type: 'raw'
    } as any)
  })

  beforeEach(() => {
    // Clear log output
    output = []

    adapter = new GitHubApp({ } as any)
    adapter.auth = jest.fn().mockReturnValue({})

    app = new Application({ adapter })

    event = {
      event: 'test',
      id: '123-456',
      payload: {
        action: 'foo',
        installation: { id: 1 }
      }
    }
  })

  describe('on', () => {
    it('calls callback when no action is specified', async () => {
      const spy = jest.fn()
      app.on('test', spy)

      expect(spy).toHaveBeenCalledTimes(0)
      await app.receive(event)
      expect(spy).toHaveBeenCalled()
      expect(spy.mock.calls[0][0]).toBeInstanceOf(Context)
      expect(spy.mock.calls[0][0].payload).toBe(event.payload)
    })

    it('calls callback with same action', async () => {
      const spy = jest.fn()
      app.on('test.foo', spy)

      await app.receive(event)
      expect(spy).toHaveBeenCalled()
    })

    it('does not call callback with different action', async () => {
      const spy = jest.fn()
      app.on('test.nope', spy)

      await app.receive(event)
      expect(spy).toHaveBeenCalledTimes(0)
    })

    it('calls callback with *', async () => {
      const spy = jest.fn()
      app.on('*', spy)

      await app.receive(event)
      expect(spy).toHaveBeenCalled()
    })

    it('calls callback x amount of times when an array of x actions is passed', async () => {
      const event2 = {
        event: 'arrayTest',
        payload: {
          action: 'bar',
          installation: { id: 2 }
        }
      } as any

      const spy = jest.fn()
      app.on(['test.foo', 'arrayTest.bar'], spy)

      await app.receive(event)
      await app.receive(event2)
      expect(spy.mock.calls.length).toEqual(2)
    })

    it('adds a logger on the context', async () => {
      const handler = jest.fn().mockImplementation(context => {
        expect(context.log).toBeDefined()
        context.log('testing')

        expect(output[0]).toEqual(expect.objectContaining({
          id: context.id,
          msg: 'testing'
        }))
      })

      app.on('test', handler)
      await app.receive(event)
      expect(handler).toHaveBeenCalled()
    })

    it('returns an authenticated client for installation.created', async () => {
      event = {
        event: 'installation',
        id: '123-456',
        payload: {
          action: 'created',
          installation: { id: 1 }
        }
      }

      app.on('installation.created', async context => {
        // no-op
      })

      await app.receive(event)

      expect(adapter.auth).toHaveBeenCalledWith(1, expect.anything())
    })

    it('returns an unauthenticated client for installation.deleted', async () => {
      event = {
        event: 'installation',
        id: '123-456',
        payload: {
          action: 'deleted',
          installation: { id: 1 }
        }
      }

      app.on('installation.deleted', async context => {
        // no-op
      })

      await app.receive(event)

      expect(adapter.auth).toHaveBeenCalledWith()
    })

    it('returns an authenticated client for events without an installation', async () => {
      event = {
        event: 'foobar',
        id: '123-456',
        payload: { /* no installation */ }
      }

      app.on('foobar', async context => {
        // no-op
      })

      await app.receive(event)

      expect(adapter.auth).toHaveBeenCalledWith()
    })
  })

  describe('receive', () => {
    it('delivers the event', async () => {
      const spy = jest.fn()
      app.on('test', spy)

      await app.receive(event)

      expect(spy).toHaveBeenCalled()
    })

    it('waits for async events to resolve', async () => {
      const spy = jest.fn()

      app.on('test', () => {
        return new Promise(resolve => {
          setTimeout(() => {
            spy()
            resolve()
          }, 1)
        })
      })

      await app.receive(event)

      expect(spy).toHaveBeenCalled()
    })

    it('returns a reject errors thrown in apps', async () => {
      app.on('test', () => {
        throw new Error('error from app')
      })

      try {
        await app.receive(event)
        throw new Error('expected error to be raised from app')
      } catch (err) {
        expect(err.message).toEqual('error from app')
      }
    })
  })

  describe('load', () => {
    it('loads one app', async () => {
      const spy = jest.fn()
      const myApp = (a: any) => a.on('test', spy)

      app.load(myApp)
      await app.receive(event)
      expect(spy).toHaveBeenCalled()
    })

    it('loads multiple apps', async () => {
      const spy = jest.fn()
      const spy2 = jest.fn()
      const myApp = (a: any) => a.on('test', spy)
      const myApp2 = (a: any) => a.on('test', spy2)

      app.load([myApp, myApp2])
      await app.receive(event)
      expect(spy).toHaveBeenCalled()
      expect(spy2).toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    let error: any

    beforeEach(() => {
      error = new Error('testing')
    })

    it('logs errors thrown from handlers', async () => {
      app.on('test', () => {
        throw error
      })

      await expect(app.receive(event)).rejects.toThrow(error)

      expect(output.length).toBe(1)
      expect(output[0].err.message).toEqual('testing')
      expect(output[0].event.id).toEqual(event.id)
    })

    it('logs errors from rejected promises', async () => {
      app.on('test', () => Promise.reject(error))

      await expect(app.receive(event)).rejects.toThrow(error)

      expect(output.length).toBe(1)
      expect(output[0].err.message).toEqual('testing')
      expect(output[0].event.id).toEqual(event.id)
    })
  })
})