
const { createReactProjectGenerator, ReactTemplate } = require('@teleporthq/teleport-project-generator-react')
const { createZipPublisher } = require('@teleporthq/teleport-publisher-zip')
const { createProjectPacker } = require('@teleporthq/teleport-project-packer')
const projectJSON = require('../../../examples/uidl-samples/project.json')

const run = async () => {
	try {
		const start = process.hrtime.bigint()
		
		const reactPacker = createProjectPacker()
		reactPacker.setTemplate(ReactTemplate)
		reactPacker.setGenerator(createReactProjectGenerator())
		reactPacker.setPublisher(createZipPublisher())
		await reactPacker.pack(projectJSON)
	
		const end = process.hrtime.bigint()
		const timeElapsed = Math.round(Number(end - start) / 1e6)
		console.log(`Time elapsed for cold start for  react ${timeElapsed}`)

	} catch(e) {
		console.error('Failed in packing project')
		console.error(e)
	}

	gc()

	const warmRuns = []
	const startRuns = process.hrtime.bigint()
	for(i = 0; i<10; i++) {
		try {
			const start = process.hrtime.bigint()
			
			const reactPacker = createProjectPacker()
			reactPacker.setTemplate(ReactTemplate)
			reactPacker.setGenerator(createReactProjectGenerator())
			reactPacker.setPublisher(createZipPublisher())
			await reactPacker.pack(projectJSON)
		
			const end = process.hrtime.bigint()
			const timeElapsed = Math.round(Number(end - start) / 1e6)
			console.log(`Time elapsed for react for ${i}th run ${timeElapsed}`)
			warmRuns.push(timeElapsed)
		} catch(e) {
			console.error('Failed in packing project')
			console.error(e)
		}
	}
	const endRuns = process.hrtime.bigint()
	console.log(`${warmRuns.length} runs - ${Math.round(Number(endRuns - startRuns) / 1e6)}`)
	const totalTime = warmRuns.reduce((a, b) => { return a + b}, 0)
	console.log(`Average time in warm runs ${totalTime/warmRuns.length}`)
}

run()