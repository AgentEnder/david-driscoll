// Server API makes it possible to hook into various parts of Gridsome
// on server-side and add custom data to the GraphQL data layer.
// Learn more: https://gridsome.org/docs/server-api/
require("ts-node/register");
const { default: slugify } = require("slugify");
const nodeExternals = require("webpack-node-externals");
const { DateTime, FixedOffsetZone } = require("luxon");
const trianglify = require("trianglify");
const fs = require("fs");
const { getImageContent, getImagePath } = require("./src/defaultImage");
const { join } = require("path");

// Changes here require a server restart.
// To restart press CTRL + C in terminal and run `gridsome develop`

const colors = ["PuOr", "PRGn", "PiYG", "RdBu", "RdYlBu", "Spectral", "RdYlGn"];
/*Object.keys(trianglify.utils.colorbrewer).filter(
  (z) => !z.endsWith("s")
);*/

function ensureImage(data, key) {
  if (!data.image) data.image = { path: undefined };
  if (!data.image.path) {
    data.description = data.description || "";
    data.image.path = saveImage(key);
  }

  return data.image;
}

function saveImage(key) {
  const content = getImageContent(key);
  fs.writeFileSync(join(__dirname, "static", getImagePath(key)), content);
  return getImagePath(key);
}

/**
 * @param {object} data
 * @param {string} data.id
 * @param {string} data.$uid
 * @param {string} data.path
 * @param {Date} data.date
 * @param {string[]} [data.tags]
 * @param {string} [data.series]
 * @param {object} data.internal
 * @param {string} data.internal.typeName
 * @param {string} data.internal.origin
 * @param {number} data.internal.timestamp
 */
function onBlogPost(data) {
  data.tags = data.tags || [];
  data.description = data.description || "";
  data.path = `/blog${data.dateInfo.path}${data.slug}`;

  ensureImage(data, data.title);

  let now = DateTime.utc();
  data.isFuture = DateTime.fromJSDate(data.date) > now;

  var parts = data.internal.origin.split(/[\/|\\]/g);
  var series = parts.filter((part) => part.startsWith("$series"));
  if (series.length) {
    data.series = series[0].substring("$series".length);
    if (data.series.startsWith("-")) data.series = data.series.substring(1);
  }

  // console.log(data);
}

/**
 * @param {object} data
 * @param {string} data.id
 * @param {string} data.$uid
 * @param {string} data.path
 * @param {string} data.title
 * @param {string} data.description
 * @param {object} data.internal
 * @param {string} data.internal.typeName
 * @param {string} data.internal.origin
 * @param {number} data.internal.timestamp
 * @param {string} data.fileInfo.name
 * @param {string} data.fileInfo.path
 * @param {string} data.fileInfo.extension
 * @param {string} data.fileInfo.directory
 */
function onSeries(data) {
  data.id = data.fileInfo.name;
  ensureImage(data, data.id);
  data.hasPosts = false;
  data.lastPost = new Date(0);
  // console.log(data);
}

/**
 * @param {object} data
 * @param {string} data.id
 * @param {string} data.$uid
 * @param {string} data.path
 * @param {string} data.title
 * @param {string} data.description
 * @param {object} data.internal
 * @param {string} data.internal.typeName
 * @param {string} data.internal.origin
 * @param {number} data.internal.timestamp
 * @param {string} data.fileInfo.name
 * @param {string} data.fileInfo.path
 * @param {string} data.fileInfo.extension
 * @param {string} data.fileInfo.directory
 */
function onTag(data) {
  data.count = 1;
  // console.log(data);
}

/** @type import('@tyankatsu0105/types-gridsome').Server */
module.exports = function(api) {
  api.loadSource((actions) => {
    const blogs = actions.getCollection("BlogPost");
    const series = actions.getCollection("Series");
    const tags = actions.getCollection("Tag");
    for (const item of series.data()) {
      item.hasPosts = blogs.data().some((z) => z.series === item.id);
      item.lastPost = item.hasPosts
        ? blogs
            .data()
            .filter((z) => z.series === item.id)
            .reduce(
              (acc, v) => (acc.date > v.date ? acc.date : v.date),
              new Date(0)
            )
        : null;
    }

    const counts = {};
    for (const item of blogs.data()) {
      for (const tag of item.tags) {
        counts[tag] = (counts[tag] || 0) + 1;
      }
    }
    console.log(counts);
    for (const [key, value] of Object.entries(counts)) {
      tags.getNodeById(key).count = value;
    }
  });

  function onPreCreateNode(data) {
    if (data.date) {
      data.dateInfo = createDateInfo(data.date);
    }
    if (!data.slug) {
      if (data.title) {
        data.slug = slugify(data.title).toLowerCase();
      } else if (data.name) {
        data.slug = slugify(data.name).toLowerCase();
      } else {
        data.slug = slugify(data.id).toLowerCase();
      }
    }
  }
  function onPostCreateNode(data) {
    if (data.path && data.slug) {
      data.path = data.path.replace(/\/slug/g, "/" + data.slug);
    }
    console.log(data.internal.typeName);
  }
  api.onCreateNode(onPreCreateNode);
  api.onCreateNode(onTypeCreated("BlogPost", onBlogPost));
  api.onCreateNode(onTypeCreated("Series", onSeries));
  api.onCreateNode(onTypeCreated("Tag", onTag));
  api.onCreateNode(onPostCreateNode);

  // api.beforeBuild((...args) => console.log('beforeBuild', args));
  // api.afterBuild((...args) => console.log('afterBuild', args));
  api.onBootstrap(async (...args) => {
    const pages = await api._app.graphql(`
      {
        data: allPage(filter: {}) {
          path
        }
      }
    `);
    for (const { path } of pages.data.data) {
      saveImage(path);
    }
  });

  // console.log(api);
  api.chainWebpack((config, { isServer }) => {
    if (isServer) {
      config.externals([
        nodeExternals({
          allowlist: [/^vuetify/],
        }),
      ]);
    }
  });

  api.createPages(async ({ createPage, graphql, getCollection }) => {
    const result = await graphql(`
      #graphql
      query {
        posts: allBlogPost(
          sort: { by: "date", order: ASC }
          filter: { isFuture: { ne: true } }
        ) @paginate {
          edges {
            node {
              id
              title
              date
              path
              slug
              dateInfo {
                day
                month
                year
                path
              }
            }
          }
        }
      }
    `);

    const edges = result.data.posts.edges;
    for (let i = 0; i < edges.length; i++) {
      const node = edges[i].node;
      const prev = edges[i - 1];
      const next = edges[i + 1];
      const path = `/blog${node.dateInfo.path}${node.slug}`;
      console.log(node.date, path);

      // const imageData = {};
      // ensureImage(imageData);

      createPage({
        path,
        component: "./src/templates/blog/Post.vue",
        context: {},
        queryVariables: {
          id: node.id,
          prev: prev ? prev.node.id : null,
          next: next ? next.node.id : null,
        },
      });
    }

    createPage({
      path: "/series/",
      component: "./src/templates/series/Summary.vue",
      context: {},
    });
    createPage({
      path: "/blog/",
      component: "./src/templates/blog/List.vue",
      context: {},
    });
    createPage({
      path: "/tags/",
      component: "./src/templates/tags/List.vue",
      context: {},
    });
    // createPage({
    //   path: "/series/:id",
    //   component: "./src/templates/series/Index.vue",
    // });
  });
};

/**
 *
 * @param {string} typeName
 * @param {Function} fn
 */
function onTypeCreated(typeName, fn) {
  return onTypeCreatedResult;

  /**
   * @param {object} data
   * @param {string} data.id
   * @param {string} data.$uid
   * @param {string} [data.path]
   * @param {Date} [data.date]
   * @param {object} data.internal
   * @param {string} data.internal.typeName
   * @param {string} data.internal.origin
   * @param {number} data.internal.timestamp
   */
  function onTypeCreatedResult(data) {
    if (data.internal.typeName === typeName) fn(data);
  }
}

function mulberry32(seed) {
  if (!seed) {
    seed = Math.random().toString(36);
  } // support no-seed usage
  var a = xmur3(seed)();
  return function() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function xmur3(str) {
  for (var i = 0, h = 1779033703 ^ str.length; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function createDateInfo(value) {
  const date =
    typeof value === "string"
      ? DateTime.fromISO(value, { zone: FixedOffsetZone.utcInstance })
      : DateTime.fromJSDate(value, { zone: FixedOffsetZone.utcInstance });
  const month = date.toFormat("MM");
  const day = date.toFormat("dd");
  const year = date.year.toString();
  const path = `/${date.year}/${month}/${day}/`;
  return {
    day,
    month,
    year,
    path,
  };
}
