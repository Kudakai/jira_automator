const axios = require("axios");
require("dotenv").config();
const express = require("express")
const bodyparser = require("body-parser")


const app = express();

app.use(express.json());

app.post('/addtoconf', async (req, res, next) => {
    console.log(`Request has been received`)
    console.log({summary: req.body.fields.summary, description: req.body.fields.description})
    const issueObject = {
        summary: req.body.fields.summary, 
        description: req.body.fields.description
    }
    console.log(issueObject)

    const responseFromAi = await getAiSummary(issueObject)
    console.log(responseFromAi)
    const pageContent = await getPageContent()
    

    const newContent = {
        initiative: req.body.fields.summary,
        summary: req.body.fields.description,
        description: responseFromAi
    };

    const responseFromUpdate = await updatePageContent(5931009, newContent)
    console.log(responseFromUpdate)
    console.log("Script has been successfully ended")
    res.end()

})


app.listen(process.env.PORT, () => {
    console.log(`Server is up and running on ${process.env.PORT}`)
})

const confluenceAPI = axios.create({
    baseURL: `${process.env.CONFLUENCE_URL}/wiki/api/v2`,
    auth: {
        username: process.env.CONFLUENCE_EMAIL,
        password: process.env.CONFLUENCE_TOKEN
    },
    headers: {
        Accept: "application/json"
    }
});

const jiraAPI = axios.create({
    baseURL: `${process.env.JIRA_URL}/rest/api/2`,
    auth: {
        username: process.env.JIRA_EMAIL,
        password: process.env.JIRA_TOKEN
    },
    headers: {
        Accept: "application/json"
    }
});

const claudeAPI = axios.create({
    baseURL: "https://api.anthropic.com/v1",
    headers: {
        Authorization: `Bearer ${process.env.CLAUD_TOKEN}`,
        "anthropic-version": "2026-10-21",
        "Content-Type": "application/json"
    }
});


async function getIssueDetails(issueId) {
    const response = await jiraAPI.get(`/issue/${issueId}`);
    const data = response.data;
    return data;
}


async function getPageContent(pageId) {
    const response = await confluenceAPI.get(`/pages/${pageId}`, {
        params: {
            "body-format": "storage"
        }
    });

    const pageContent = response.data;
    return pageContent;
}


async function updatePageContent(pageId, newContent) {
    const dataFromPage = await getPageContent(pageId);
    const currentBody = dataFromPage.body.storage.value;

    const escapeHtml = value => String(value ?? "").replace(
        /[&<>"']/g,
        char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[char]
    );

    const newRow = `
        <tr>
            <td><p>${escapeHtml(newContent.initiative)}</p></td>
            <td><p>${escapeHtml(newContent.summary)}</p></td>
            <td><p>${escapeHtml(newContent.description)}</p></td>
            <td><p>${new Date().toISOString()}</p></td>
        </tr>
    `;

    const updatedBody = currentBody.replace(
        "</tbody>",
        `${newRow}</tbody>`
    );

    const result = await confluenceAPI.put(`/pages/${pageId}`, {
        id: dataFromPage.id,
        status: "current",
        title: dataFromPage.title,
        body: {
            representation: "storage",
            value: updatedBody
        },
        version: {
            number: dataFromPage.version.number + 1,
            message: "Updated through Node.js"
        }
    });

    return result;
}


async function getAiSummary(issueObject) {
    const response = await claudeAPI.post("/messages", {
        model: "claude-haiku-5-5",
        max_tokens: 600,
        thinking: {
            type: "disabled"
        },
        system: `You are an AI assistant responsible for preparing concise summaries for an Initiatives table in Confluence.

Your task is to analyze the provided Jira issue summary and description and generate a short, clear description of the implemented initiative.

Requirements:
1. Write 1–2 sentences, maximum 50 words.
2. Focus on what was implemented or delivered and its purpose.
3. Use professional, business-friendly language suitable for management.
4. Avoid unnecessary technical details, jargon, and repetitive information.
5. Use only information provided in the Jira issue.
6. Do not invent features, results, benefits, or implementation details.
7. If the description is insufficient, summarize only what can be confidently determined.
8. Return only the final summary as plain text, without headings, explanations, or formatting.`,

        messages: [
            {
                role: "user",
                content: JSON.stringify(issueObject)
            }
        ]
    });

    const textBlock = response.data.content.find(
        block => typeof block.text === "string" && block.text.trim()
    );

    if (!textBlock) {
        throw new Error(
            `No summary returned. Stop reason: ${response.data.stop_reason}`
        );
    }

    return textBlock.text.trim();
}



async function changeStatusTriggered(issueID) {
    const issueDetails = await getIssueDetails(issueID);

    const requiredIssueData = {
        summary: issueDetails.fields.summary,
        description: issueDetails.fields.description
    };

    const response = await getAiSummary(requiredIssueData);

    const newContent = {
        initiative: issueDetails.key,
        summary: issueDetails.fields.summary,
        description: response
    };

    await updatePageContent(5931009, newContent);

    console.log("Confluence updated successfully");
}
