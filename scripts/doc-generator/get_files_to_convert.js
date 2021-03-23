const { promisify } = require("util");
const fs = require("fs");
const path = require("path");

/**
 * Returns information about every Markdown files we have to convert to HTML
 * in an array.
 *
 * The returned Array contains Objects with the following keys:
 *   - inputFile {string}: normalized absolute path to the markdown file to
 *     convert
 *   - outputFile {string}: normalized absolute path to where the resulting
 *     HTML file should be stored
 * @param {string} baseInDir - The directory where the markdown files are. This
 * directory will be checked for files recursively.
 * @param {string} baseOutDir - The directory where the resulting HTML files
 * will reside.
 * @param {Object} [opts = {}]
 * @param {Function|undefined} opts.fileFilter
 * @returns {Promise.<Array.<Object>>}
 */
module.exports = async function getFilesToConvert(
  baseInDir,
  baseOutDir,
  opts = {},
) {
  const filesToConvert = [];
  const { fileFilter } = opts;
  async function recusiveGetFilesToConvert(inputDir, outputDir) {
    // Loop through all the files in the temp directory
    let files;
    try {
      files = await promisify(fs.readdir)(inputDir);
    } catch (err) {
      throw new Error("error while reading directory: " + err);
    }

    const filteredFiles = fileFilter != null ?
      files.filter((fileName) => fileFilter(fileName, baseInDir)) :
      files;

    for (let i = 0; i < filteredFiles.length; i++) {
      const file = filteredFiles[i];
      const filePath = path.join(inputDir, file);
      let stat;
      try {
        stat = await promisify(fs.stat)(filePath);
      } catch (err) {
        throw new Error("error while stating file: " + err);
      }

      if (stat.isDirectory()) {
        const newOutDir = path.join(outputDir, file);
        await recusiveGetFilesToConvert(filePath, newOutDir);
      } else if(stat.isFile()) {
        const extname = path.extname(file);
        if (extname === ".md") {
          const outputFile =
            path.join(outputDir, path.basename(filePath, ".md") + ".html");

          filesToConvert.push({
            inputFile: path.normalize(path.resolve(filePath)),
            outputFile: path.normalize(path.resolve(outputFile)),
          });
        }
      }
    }
  }
  await recusiveGetFilesToConvert(baseInDir, path.join(baseOutDir, "pages"));
  return filesToConvert;
};

// ```js
// {
//   // Different documentation "Categories", which are their own separate
//   // group of documentation pages.
//   // Those are in the order that we want to display them.
//   //
//   // The default page used for this category should be the very first
//   // page anounced in it (which can be part of a "page group").
//   categories: [
//     {
//       // Name of the category that should be displayed
//       displayName: "",
//
//       // List of documentation "pages" in that directory, in order at which
//       // we want to display them.
//       pages: [
//         {
//           // If `false` this object represents a documentation page.
//           // In that case this object will have an `inputFile` and
//           // `outputFile` property (documented here).
//           //
//           // If `true` this Object represents a "page group", that is, it
//           // regroups multiple documentation pages.
//           // Here the `pages` property would indicate which pages (and in
//           // which order) are part of this page group.
//           // Note that a page group cannot contain another page group.
//           isPageGroup: false,
//
//           // Name that should be displayed for that page
//           displayName: "",
//
//           inputFile: "",
//           outputFile: "",
//         }
//
//         // second element, to showcase a page group
//         {
//           isPageGroup: true,
//
//           // Pages in  that page group
//           outputFile: "",
//         }
//       ]
//     }
//   ]
// }
// ```
