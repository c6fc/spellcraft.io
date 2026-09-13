/*
	Gives a node heading its own name as its anchor, so `## aws.terraform.lambda`
	is reachable at `#aws.terraform.lambda` rather than at github-slugger's
	`#awsterraformlambda`.

	The default slug is derived by dropping punctuation, which is fine for prose
	headings and wrong here: these headings *are* import paths, and the dotted
	form is what a reader would guess, type, or paste from a call site.

	Only headings whose entire text is a node name are touched -- one or more
	lowercase segments joined by dots, plus bare `terraform`, which is a node
	with no parent. Every prose heading keeps the default slug.
*/

const NODE_NAME = /^(terraform|[a-z][a-z0-9]*(?:\.[a-z0-9]+)+)$/;

function textOf(node) {
	if (node.type === 'text') return node.value;

	return (node.children ?? []).map(textOf).join('');
}

export function rehypeNodeAnchors() {
	return (tree) => {
		const visit = (node) => {
			if (node.type === 'element' && node.tagName === 'h2') {
				const text = textOf(node).trim();

				if (NODE_NAME.test(text)) {
					node.properties = { ...node.properties, id: text };
				}
			}

			for (const child of node.children ?? []) visit(child);
		};

		visit(tree);
	};
}
