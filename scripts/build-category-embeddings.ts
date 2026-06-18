import 'dotenv/config'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { CATEGORIES } from '../lib/categories'
import { embed } from '../lib/embeddings'

async function main() {
  const out: { name: string; vector: number[] }[] = []
  for (const category of CATEGORIES) {
    process.stdout.write(`Embedding "${category.name}"... `)
    const vector = await embed(category.reference)
    out.push({ name: category.name, vector })
    console.log(`ok (${vector.length} dims)`)
  }
  const target = join(__dirname, '..', 'lib', 'category-vectors.json')
  writeFileSync(target, JSON.stringify(out, null, 2) + '\n')
  console.log(`Wrote ${out.length} vectors to ${target}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
