import fs from "fs";

function wrap(filePath, outName) {
  const b = fs.readFileSync(filePath).toString("base64");
  const tag = "$rf071_z2$";
  const sql =
    `DO ${tag}\n` +
    "BEGIN\n" +
    `  EXECUTE convert_from(decode('${b}', 'base64'), 'UTF8');\n` +
    "END\n" +
    `${tag};`;
  fs.writeFileSync(outName, sql, "utf8");
  console.log(outName, sql.length, "chars");
}

wrap("part2.sql", "_exec_part2.sql");
wrap("part1.sql", "_exec_part1.sql");

for (const name of ["_exec_part2.sql", "_exec_part1.sql"]) {
  const q = fs.readFileSync(name, "utf8");
  fs.writeFileSync(
    name.replace(".sql", "_execute_payload.json"),
    JSON.stringify({ project_id: "xwubxpcixxwfoduwyzmo", query: q }),
    "utf8",
  );
  console.log(name.replace(".sql", "_execute_payload.json"), "bytes", Buffer.byteLength(JSON.stringify({ project_id: "xwubxpcixxwfoduwyzmo", query: q }), "utf8"));
}
