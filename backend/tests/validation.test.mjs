import 'reflect-metadata'
import assert from 'node:assert/strict'
import test from 'node:test'
import { ValidationPipe } from '@nestjs/common'
import { IsString, Length } from 'class-validator'

class Input {}
IsString()(Input.prototype, 'name')
Length(1, 20)(Input.prototype, 'name')

test('Nest validation rejects invalid values and unexpected fields', async () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
  const metadata = { type: 'body', metatype: Input }
  assert.equal((await pipe.transform({ name: 'test' }, metadata)).name, 'test')
  for (const input of [{ name: 123 }, { name: '' }, { name: 'test', actorId: 'forged' }]) {
    await assert.rejects(pipe.transform(input, metadata), (error) => error.getStatus() === 400)
  }
})
