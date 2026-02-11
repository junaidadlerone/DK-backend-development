import { parse } from "https://deno.land/std@0.224.0/yaml/mod.ts";

async function validateOpenAPI() {
    const openApiPath = "./docs/openapi.yaml";
    try {
        const yamlContent = await Deno.readTextFile(openApiPath);

        // 1. Basic YAML Parsing
        console.log("Validating YAML syntax...");
        const parsed = parse(yamlContent);
        console.log("✅ YAML syntax is valid.");

        // 2. Check for Duplicate operationIds
        console.log("Checking for duplicate operationIds...");
        const operationIds = new Set<string>();
        const duplicates = new Set<string>();

        function traverse(obj: any) {
            if (!obj || typeof obj !== "object") return;

            if (obj.operationId) {
                if (operationIds.has(obj.operationId)) {
                    duplicates.add(obj.operationId);
                }
                operationIds.add(obj.operationId);
            }

            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    traverse(obj[key]);
                }
            }
        }

        traverse(parsed);

        if (duplicates.size > 0) {
            console.error("❌ Found duplicate operationIds:");
            duplicates.forEach((id) => console.error(`   - ${id}`));
            Deno.exit(1);
        } else {
            console.log("✅ No duplicate operationIds found.");
        }

        console.log("🎉 OpenAPI definition is valid!");
    } catch (error) {
        console.error("❌ Error validating OpenAPI file:");
        if (error instanceof Error) {
            console.error(error.message);
        } else {
            console.error(error);
        }
        Deno.exit(1);
    }
}

validateOpenAPI();
